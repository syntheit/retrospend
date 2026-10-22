/**
 * M5 membership dates on Postgres: the backfill, membersOn (RC-11), setting
 * dates, and how a join date keeps earlier expenses out of a rebalance.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { adminDb } from "~/test/pg-harness";
import {
	addMember,
	callerFor,
	namedUser,
	seedExpense,
	seedTrip,
} from "./trip-fixture";

vi.mock("~/server/mailer", () => ({ sendEmail: vi.fn(async () => {}) }));

const migration = readFileSync(
	new URL(
		"../../../../../prisma/migrations/20261023300000_project_membership_dates/migration.sql",
		import.meta.url,
	),
	"utf8",
);
const backfill = migration.slice(
	migration.indexOf('UPDATE "project_participant"'),
);

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

describe("M5 backfill", () => {
	it("dates later joiners by their first expense or join day, never founders", async () => {
		const ana = await namedUser("Ana");
		const ben = await namedUser("Ben");
		const cam = await namedUser("Cam");
		const dan = await namedUser("Dan");
		const project = await adminDb.project.create({
			data: {
				name: "Backfill",
				createdById: ana.user.id,
				createdAt: new Date("2026-10-01T15:00:00Z"),
			},
		});
		const at = (iso: string) => new Date(`${iso}T15:00:00Z`);
		const row = async (id: string, joinedAt: string) =>
			adminDb.projectParticipant.create({
				data: {
					projectId: project.id,
					participantType: "user",
					participantId: id,
					joinedAt: at(joinedAt),
				},
			});
		const founder = await row(ana.user.id, "2026-10-01");
		const inEarlier = await row(ben.user.id, "2026-10-20");
		const noExpenses = await row(cam.user.id, "2026-10-20");
		// 01:00 UTC on Oct 21 is 22:00 on Oct 20 in Buenos Aires (UTC-3).
		const lateEvening = await adminDb.projectParticipant.create({
			data: {
				projectId: project.id,
				participantType: "user",
				participantId: dan.user.id,
				joinedAt: new Date("2026-10-21T01:00:00Z"),
			},
		});
		// Ben is in an expense dated before he was added: the expense wins.
		await seedExpense(project.id, {
			description: "Hotel",
			amount: "100",
			currency: "BRL",
			date: "2026-10-09",
			paidBy: { type: "user", id: ana.user.id },
			splits: [
				{ type: "user", id: ana.user.id, share: "50" },
				{ type: "user", id: ben.user.id, share: "50" },
			],
		});

		const dates = async () =>
			Object.fromEntries(
				(
					await adminDb.projectParticipant.findMany({
						where: { projectId: project.id },
					})
				).map((r) => [r.id, day(r.joinedOn)]),
			);
		await adminDb.$executeRawUnsafe(backfill);
		const first = await dates();
		expect(first).toEqual({
			[founder.id]: null,
			[inEarlier.id]: "2026-10-09",
			[noExpenses.id]: "2026-10-20",
			[lateEvening.id]: "2026-10-20",
		});
		await adminDb.$executeRawUnsafe(backfill);
		expect(await dates()).toEqual(first);
	});

	it("rejects a leave date on or before the join date in the database too", async () => {
		const trip = await seedTrip();
		await expect(
			adminDb.projectParticipant.updateMany({
				where: { projectId: trip.project.id, participantId: trip.cam.user.id },
				data: {
					joinedOn: new Date("2026-10-10T00:00:00Z"),
					leftOn: new Date("2026-10-10T00:00:00Z"),
				},
			}),
		).rejects.toThrow(/membership_dates_check/);
	});
});

describe("project.membersOn (RC-11)", () => {
	it("includes only people who had joined and not yet left", async () => {
		const trip = await seedTrip();
		const ana = callerFor(trip.ana.user);
		await ana.setMembershipDates({
			projectId: trip.project.id,
			participantType: "user",
			participantId: trip.cam.user.id,
			joinedOn: "2026-10-11",
		});
		await ana.setMembershipDates({
			projectId: trip.project.id,
			participantType: "shadow",
			participantId: trip.sam.id,
			leftOn: "2026-10-12",
		});
		const names = async (date: string) =>
			(
				await callerFor(trip.ben.user).membersOn({
					projectId: trip.project.id,
					date,
				})
			)
				.map((m) => m.participantId)
				.sort();
		const { A, B, C, S } = trip.refs;
		expect(await names("2026-10-10")).toEqual([A.id, B.id, S.id].sort());
		expect(await names("2026-10-11")).toEqual([A.id, B.id, C.id, S.id].sort());
		expect(await names("2026-10-12")).toEqual([A.id, B.id, C.id].sort());
	});

	it("keeps today's numbers: dates never touch existing splits", async () => {
		const trip = await seedTrip();
		const before = await callerFor(trip.ana.user).participantBalances({
			projectId: trip.project.id,
		});
		await callerFor(trip.ana.user).setMembershipDates({
			projectId: trip.project.id,
			participantType: "user",
			participantId: trip.cam.user.id,
			joinedOn: "2026-10-20",
		});
		const after = await callerFor(trip.ana.user).participantBalances({
			projectId: trip.project.id,
		});
		expect(after).toEqual(before);
	});

	it("refuses a non-member", async () => {
		const trip = await seedTrip();
		await expect(
			callerFor(trip.outsider.user).membersOn({
				projectId: trip.project.id,
				date: "2026-10-10",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("project.setMembershipDates", () => {
	it("sets, keeps and clears dates, and audits the change", async () => {
		const trip = await seedTrip();
		const ana = callerFor(trip.ana.user);
		const who = {
			projectId: trip.project.id,
			participantType: "user" as const,
			participantId: trip.cam.user.id,
		};
		await expect(
			ana.setMembershipDates({ ...who, joinedOn: "2026-10-11" }),
		).resolves.toMatchObject({ joinedOn: "2026-10-11", leftOn: null });
		await expect(
			ana.setMembershipDates({ ...who, leftOn: "2026-10-20" }),
		).resolves.toMatchObject({ joinedOn: "2026-10-11", leftOn: "2026-10-20" });
		await expect(
			ana.setMembershipDates({ ...who, joinedOn: null }),
		).resolves.toMatchObject({ joinedOn: null, leftOn: "2026-10-20" });
		const audits = await adminDb.auditLogEntry.findMany({
			where: { projectId: trip.project.id, action: "EDITED" },
			orderBy: { timestamp: "asc" },
		});
		expect(audits[0]?.changes).toEqual({
			participantType: "user",
			participantId: trip.cam.user.id,
			membership: {
				old: { joinedOn: null, leftOn: null },
				new: { joinedOn: "2026-10-11", leftOn: null },
			},
		});
	});

	it("refuses a leave before the join, a bad day, and a contributor", async () => {
		const trip = await seedTrip();
		const who = {
			projectId: trip.project.id,
			participantType: "user" as const,
			participantId: trip.cam.user.id,
		};
		await expect(
			callerFor(trip.ana.user).setMembershipDates({
				...who,
				joinedOn: "2026-10-11",
				leftOn: "2026-10-10",
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(
			callerFor(trip.ana.user).setMembershipDates({
				...who,
				joinedOn: "2026-02-30",
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
		await expect(
			callerFor(trip.cam.user).setMembershipDates({
				...who,
				joinedOn: "2026-10-11",
			}),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});
});

describe("join dates and rebalancing", () => {
	it("stores the join date and keeps earlier expenses out by default", async () => {
		const trip = await seedTrip();
		const olga = trip.outsider.user.id;
		const ana = callerFor(trip.ana.user);
		const added = await ana.addParticipant({
			projectId: trip.project.id,
			participantType: "user",
			participantId: olga,
			joinedOn: "2026-10-10",
		});
		expect(day(added.joinedOn)).toBe("2026-10-10");

		const offered = await ana.rebalanceableExpenses({
			projectId: trip.project.id,
			participantType: "user",
			participantId: olga,
		});
		expect(offered.map((e) => [e.description, e.beforeJoin])).toEqual([
			["Boat", false],
			["Car", false],
			["Hotel", true],
		]);

		// "All eligible" never reaches back before she joined.
		const all = await ana.rebalanceExpenses({
			projectId: trip.project.id,
			participantType: "user",
			participantId: olga,
		});
		expect(all.rebalancedIds).toEqual([trip.expenses.car.id]);
		expect(all.skipped).toContainEqual({
			id: trip.expenses.hotel.id,
			reason: "before_join",
		});

		// Picked by hand, it is the editor's call.
		const picked = await ana.rebalanceExpenses({
			projectId: trip.project.id,
			participantType: "user",
			participantId: olga,
			expenseIds: [trip.expenses.hotel.id],
		});
		expect(picked.rebalancedIds).toEqual([trip.expenses.hotel.id]);
	});

	it("adds without a date exactly as before", async () => {
		const trip = await seedTrip();
		const p = await addMember(
			trip.project.id,
			"user",
			trip.outsider.user.id,
			"VIEWER",
		);
		expect(p.joinedOn).toBeNull();
		const added = await callerFor(trip.ana.user).addParticipant({
			projectId: trip.project.id,
			participantType: "shadow",
			participantId: (
				await adminDb.shadowProfile.create({
					data: { createdById: trip.ana.user.id, name: "Gil" },
				})
			).id,
		});
		expect(added.joinedOn).toBeNull();
	});
});
