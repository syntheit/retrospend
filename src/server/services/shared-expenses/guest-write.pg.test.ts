/**
 * A guest contributor writes expenses through the owner connection: RLS knows
 * users only, and the guest's rights are checked in the service
 * (requireProjectRole). Dropping to the app role for a guest made every write
 * fail the shared_transaction insert policy.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createCallerFactory } from "~/server/api/trpc";
import { sharedTransactionRouter } from "~/server/api/routers/shared-transaction";
import { adminDb } from "~/test/pg-harness";
import { seedGuest, seedTrip, type Trip } from "../project/__tests__/trip-fixture";
import { SharedTransactionService } from "./transaction.service";

vi.mock("~/server/mailer", () => ({ sendEmail: vi.fn(async () => {}) }));

let trip: Trip;
let elsewhere: Trip;
let token: string;
let guest: Awaited<ReturnType<typeof seedGuest>>["guest"];

beforeAll(async () => {
	trip = await seedTrip();
	const seeded = await seedGuest(trip);
	guest = seeded.guest;
	token = seeded.token;
	elsewhere = await seedTrip();
});

const me = () => ({ participantType: "guest" as const, participantId: guest.id });
const ana = () => ({
	participantType: "user" as const,
	participantId: trip.ana.user.id,
});

describe("a guest contributor", () => {
	it("adds an expense to the project, edits it and deletes it", async () => {
		const service = new SharedTransactionService(adminDb, me());
		const created = await service.create({
			amount: 30,
			currency: "BRL",
			description: "Guest taxi",
			date: new Date(),
			paidBy: me(),
			splitWith: [me(), ana()],
			splitMode: "EQUAL",
			projectId: trip.project.id,
		});
		const id = created.transaction.id;
		const rows = await adminDb.splitParticipant.findMany({
			where: { transactionId: id },
		});
		expect(rows.map((r) => Number(r.shareAmount)).sort()).toEqual([15, 15]);

		await service.update({ id, description: "Guest cab" });
		expect(
			(await adminDb.sharedTransaction.findUniqueOrThrow({ where: { id } }))
				.description,
		).toBe("Guest cab");

		await service.delete(id, { confirmUnsettled: true });
		expect(
			await adminDb.sharedTransaction.count({ where: { id } }),
		).toBe(0);
	});
});

describe("a guest stays in their own project", () => {
	const service = () => new SharedTransactionService(adminDb, me());
	const input = (projectId?: string) => ({
		amount: 10,
		currency: "BRL",
		description: "Not mine",
		date: new Date(),
		paidBy: me(),
		splitWith: [me()],
		splitMode: "EQUAL" as const,
		projectId,
	});

	it("cannot create in another project", async () => {
		await expect(service().create(input(elsewhere.project.id))).rejects.toThrow(
			/not a participant/,
		);
	});

	it("cannot create without a project", async () => {
		await expect(service().create(input())).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
	});

	it("cannot edit or delete an expense of another project", async () => {
		const theirs = await adminDb.sharedTransaction.findFirstOrThrow({
			where: { projectId: elsewhere.project.id },
		});
		await expect(
			service().update({ id: theirs.id, description: "Mine now" }),
		).rejects.toThrow();
		await expect(service().delete(theirs.id)).rejects.toThrow();
		expect(
			(
				await adminDb.sharedTransaction.findUniqueOrThrow({
					where: { id: theirs.id },
				})
			).description,
		).not.toBe("Mine now");
	});

	it("is stopped at the door for another project and with no project, by token", async () => {
		const caller = createCallerFactory(sharedTransactionRouter)({
			db: adminDb,
			session: null,
			headers: new Headers({ "x-guest-token": token }),
		} as never);
		await expect(caller.create(input(elsewhere.project.id))).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
		await expect(caller.create(input())).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
		const unknown = createCallerFactory(sharedTransactionRouter)({
			db: adminDb,
			session: null,
			headers: new Headers({ "x-guest-token": randomUUID() }),
		} as never);
		await expect(unknown.create(input(trip.project.id))).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
	});
});
