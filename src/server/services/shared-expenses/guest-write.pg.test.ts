/**
 * A guest contributor writes expenses through the owner connection: RLS knows
 * users only, and the guest's rights are checked in the service
 * (requireProjectRole). Dropping to the app role for a guest made every write
 * fail the shared_transaction insert policy.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "~/test/pg-harness";
import { seedGuest, seedTrip, type Trip } from "../project/__tests__/trip-fixture";
import { SharedTransactionService } from "./transaction.service";

let trip: Trip;
let guest: Awaited<ReturnType<typeof seedGuest>>["guest"];

beforeAll(async () => {
	trip = await seedTrip();
	guest = (await seedGuest(trip)).guest;
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
