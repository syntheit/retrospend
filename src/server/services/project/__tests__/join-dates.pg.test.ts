/**
 * Join dates for people added without one, and the one day rule
 * (userTimeZone, Buenos Aires by default, UTC-3), on Postgres.
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { dayKey } from "~/lib/time-zone";
import { guestRouter } from "~/server/api/routers/guest";
import { createCallerFactory } from "~/server/api/trpc";
import { createUserScopedDb } from "~/server/db";
import { SharedTransactionService } from "~/server/services/shared-expenses/transaction.service";
import { adminDb } from "~/test/pg-harness";
import { defaultJoinedOn } from "../join-date";
import { callerFor, seedExpense, seedTrip } from "./trip-fixture";

vi.mock("~/server/mailer", () => ({ sendEmail: vi.fn(async () => {}) }));

const BA = "America/Argentina/Buenos_Aires";
const day = (d: Date | null | undefined) =>
	d ? d.toISOString().slice(0, 10) : null;
const todayInBA = () => dayKey(new Date(), BA);

/** A trip whose project was created on Oct 1, so today is not its first day. */
async function olderTrip() {
	const trip = await seedTrip();
	await adminDb.project.update({
		where: { id: trip.project.id },
		data: { createdAt: new Date("2026-10-01T15:00:00Z") },
	});
	return trip;
}

const joinedOnOf = async (
	projectId: string,
	participantType: "user" | "shadow" | "guest",
	participantId: string,
) =>
	day(
		(
			await adminDb.projectParticipant.findUnique({
				where: {
					projectId_participantType_participantId: {
						projectId,
						participantType,
						participantId,
					},
				},
			})
		)?.joinedOn,
	);

describe("defaultJoinedOn", () => {
	it("reads today in the user's zone: 22:00 Oct 20 in UTC-3 is Oct 20", async () => {
		const trip = await olderTrip();
		const lateEvening = new Date("2026-10-21T01:00:00Z");
		const joined = await defaultJoinedOn(adminDb, trip.project.id, null, {
			now: lateEvening,
		});
		expect(day(joined)).toBe("2026-10-20");
	});

	it("is null on the project's first day, in that zone", async () => {
		const trip = await seedTrip();
		// Created Oct 20 at 22:00 in Buenos Aires; 23:30 the same evening is still day one.
		await adminDb.project.update({
			where: { id: trip.project.id },
			data: { createdAt: new Date("2026-10-21T01:00:00Z") },
		});
		await expect(
			defaultJoinedOn(adminDb, trip.project.id, null, {
				now: new Date("2026-10-21T02:30:00Z"),
			}),
		).resolves.toBeNull();
		const nextDay = await defaultJoinedOn(adminDb, trip.project.id, null, {
			now: new Date("2026-10-21T03:30:00Z"),
		});
		expect(day(nextDay)).toBe("2026-10-21");
	});

	it("is never after the expense that brought them in", async () => {
		const trip = await olderTrip();
		const joined = await defaultJoinedOn(adminDb, trip.project.id, null, {
			onDay: new Date("2026-10-05T12:00:00Z"),
			now: new Date("2026-10-22T12:00:00Z"),
		});
		expect(day(joined)).toBe("2026-10-05");
	});
});

describe("new joiners get a date", () => {
	it("Add person after the first day stores today; day one stays null", async () => {
		const old = await olderTrip();
		await callerFor(old.ana.user).addParticipant({
			projectId: old.project.id,
			participantType: "user",
			participantId: old.outsider.user.id,
		});
		await expect(
			joinedOnOf(old.project.id, "user", old.outsider.user.id),
		).resolves.toBe(todayInBA());

		const fresh = await seedTrip();
		await callerFor(fresh.ana.user).addParticipant({
			projectId: fresh.project.id,
			participantType: "user",
			participantId: fresh.outsider.user.id,
		});
		await expect(
			joinedOnOf(fresh.project.id, "user", fresh.outsider.user.id),
		).resolves.toBeNull();
	});

	it("joining through an invite link stores today", async () => {
		const trip = await olderTrip();
		const link = await adminDb.magicLink.create({
			data: {
				id: randomUUID(),
				projectId: trip.project.id,
				roleGranted: "CONTRIBUTOR",
				createdById: trip.ana.user.id,
			},
		});
		const guest = createCallerFactory(guestRouter)({
			db: adminDb,
			session: {
				user: { id: trip.outsider.user.id, role: "USER", isActive: true },
			} as never,
			headers: new Headers(),
		});
		await guest.joinWithAccount({ linkId: link.id });
		await expect(
			joinedOnOf(trip.project.id, "user", trip.outsider.user.id),
		).resolves.toBe(todayInBA());
	});

	it("a ghost added by splitting a backdated expense joins on its day", async () => {
		const trip = await olderTrip();
		const gil = await adminDb.shadowProfile.create({
			data: { createdById: trip.ana.user.id, name: "Gil" },
		});
		const service = new SharedTransactionService(
			createUserScopedDb(trip.ana.user.id),
			{ participantType: "user", participantId: trip.ana.user.id },
		);
		await service.create({
			amount: 40,
			currency: "BRL",
			description: "Taxi",
			date: new Date("2026-10-05T15:00:00Z"),
			paidBy: { participantType: "user", participantId: trip.ana.user.id },
			splitWith: [
				{ participantType: "user", participantId: trip.ana.user.id },
				{ participantType: "shadow", participantId: gil.id },
			],
			splitMode: "EQUAL",
			projectId: trip.project.id,
		});
		await expect(joinedOnOf(trip.project.id, "shadow", gil.id)).resolves.toBe(
			"2026-10-05",
		);
	});
});

describe("one day rule in rebalancing", () => {
	it("22:00 Oct 20 in UTC-3 is before someone who joined Oct 21", async () => {
		const trip = await seedTrip();
		const late = await seedExpense(trip.project.id, {
			description: "Late dinner",
			amount: "80",
			currency: "BRL",
			date: "2026-10-21",
			paidBy: trip.refs.A,
			splits: [
				{ ...trip.refs.A, share: "40" },
				{ ...trip.refs.B, share: "40" },
			],
		});
		// 01:00 UTC on Oct 21 is 22:00 on Oct 20 in Buenos Aires.
		await adminDb.sharedTransaction.update({
			where: { id: late.id },
			data: { date: new Date("2026-10-21T01:00:00Z") },
		});
		const ana = callerFor(trip.ana.user);
		await ana.addParticipant({
			projectId: trip.project.id,
			participantType: "user",
			participantId: trip.outsider.user.id,
			joinedOn: "2026-10-21",
		});
		const offered = await ana.rebalanceableExpenses({
			projectId: trip.project.id,
			participantType: "user",
			participantId: trip.outsider.user.id,
		});
		expect(offered.find((e) => e.id === late.id)?.beforeJoin).toBe(true);
		const all = await ana.rebalanceExpenses({
			projectId: trip.project.id,
			participantType: "user",
			participantId: trip.outsider.user.id,
		});
		expect(all.skipped).toContainEqual({ id: late.id, reason: "before_join" });
	});

	it("membersOn without a day means today in that zone", async () => {
		const trip = await seedTrip();
		const ana = callerFor(trip.ana.user);
		await ana.setMembershipDates({
			projectId: trip.project.id,
			participantType: "user",
			participantId: trip.cam.user.id,
			leftOn: todayInBA(),
		});
		const ids = (await ana.membersOn({ projectId: trip.project.id })).map(
			(m) => m.participantId,
		);
		expect(ids).not.toContain(trip.cam.user.id);
		expect(ids).toContain(trip.ben.user.id);
	});
});

describe("who may set an owner's dates", () => {
	it("only an owner; editors set other members'", async () => {
		const trip = await seedTrip();
		const on = (id: string) => ({
			projectId: trip.project.id,
			participantType: "user" as const,
			participantId: id,
			joinedOn: "2026-10-09",
		});
		await expect(
			callerFor(trip.ben.user).setMembershipDates(on(trip.ana.user.id)),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(
			callerFor(trip.ben.user).setMembershipDates(on(trip.cam.user.id)),
		).resolves.toMatchObject({ joinedOn: "2026-10-09" });
		await expect(
			callerFor(trip.ana.user).setMembershipDates(on(trip.ana.user.id)),
		).resolves.toMatchObject({ joinedOn: "2026-10-09" });
	});
});
