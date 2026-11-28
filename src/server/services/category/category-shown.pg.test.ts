/**
 * Where a category may be shown: on a split its owner created or is a person
 * on (category_shown_on_split). The function alone, each of its branches, then
 * every reader that runs as the owner and so gets no row level security: the
 * public page, a guest's and a viewer link's page, their expense list, one
 * expense, a billing period, the verification queue, and the audit log's
 * created and edited lines. Ana owns Travel. "Hotel" is hers (she created it);
 * "Fuel" is a split Ben created that Ana is not on, filed under her Travel by a
 * row from before the write rule (the hidden one).
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { auditLogRouter } from "~/server/api/routers/audit-log";
import { billingPeriodRouter } from "~/server/api/routers/billingPeriod";
import { sharedTransactionRouter } from "~/server/api/routers/shared-transaction";
import { verificationRouter } from "~/server/api/routers/verification";
import { createCallerFactory } from "~/server/api/trpc";
import { adminDb, fixtureDb, sealedSuite } from "~/test/pg-harness";
import {
	anonymousCaller,
	seedExpense,
	seedGuest,
	seedTrip,
	type Trip,
} from "../project/__tests__/trip-fixture";

vi.mock("~/server/mailer", () => ({ sendEmail: vi.fn(async () => {}) }));

const shownOn = async (categoryId: string | null, splitId: string | null) =>
	(
		await adminDb.$queryRaw<{ shown: boolean | null }[]>`
			SELECT category_shown_on_split(${categoryId}::text, ${splitId}::text) AS shown`
	)[0]?.shown;

const split = (
	trip: Trip,
	opts: {
		createdBy: { type: "user" | "guest" | "shadow"; id: string };
		people: { type: "user" | "guest" | "shadow"; id: string }[];
	},
	categoryId: string,
) =>
	seedExpense(trip.project.id, {
		description: `Split ${randomUUID().slice(0, 6)}`,
		amount: "10",
		currency: "BRL",
		date: "2026-10-15",
		paidBy: opts.createdBy,
		createdBy: opts.createdBy,
		categoryId,
		splits: opts.people.map((p) => ({ ...p, share: "5" })),
	});

describe("category_shown_on_split alone", () => {
	it("is true when the owner created the split and is not on it (I paid for you)", async () => {
		const trip = await seedTrip();
		const s = await split(
			trip,
			{ createdBy: trip.refs.A, people: [trip.refs.B, trip.refs.C] },
			trip.travel.id,
		);
		expect(await shownOn(trip.travel.id, s.id)).toBe(true);
	});

	it("is true when the owner is a person on a split someone else created", async () => {
		const trip = await seedTrip();
		const s = await split(
			trip,
			{ createdBy: trip.refs.B, people: [trip.refs.A, trip.refs.C] },
			trip.travel.id,
		);
		expect(await shownOn(trip.travel.id, s.id)).toBe(true);
	});

	it("is false when the owner neither created the split nor is on it", async () => {
		const trip = await seedTrip();
		const s = await split(
			trip,
			{ createdBy: trip.refs.B, people: [trip.refs.B, trip.refs.C] },
			trip.travel.id,
		);
		expect(await shownOn(trip.travel.id, s.id)).toBe(false);
	});

	it("does not take a guest or shadow with the owner's id for the owner", async () => {
		const trip = await seedTrip();
		const asGuest = { type: "guest" as const, id: trip.ana.user.id };
		const asShadow = { type: "shadow" as const, id: trip.ana.user.id };
		const byGuest = await split(
			trip,
			{ createdBy: asGuest, people: [trip.refs.B] },
			trip.travel.id,
		);
		const onAsShadow = await split(
			trip,
			{ createdBy: trip.refs.B, people: [asShadow] },
			trip.travel.id,
		);
		expect(await shownOn(trip.travel.id, byGuest.id)).toBe(false);
		expect(await shownOn(trip.travel.id, onAsShadow.id)).toBe(false);
	});

	it("is false for a split or category that is not there, and for none", async () => {
		const trip = await seedTrip();
		expect(await shownOn(trip.travel.id, randomUUID())).toBe(false);
		expect(await shownOn(randomUUID(), trip.expenses.hotel.id)).toBe(false);
		expect(await shownOn(null, trip.expenses.hotel.id)).toBe(false);
		expect(await shownOn(trip.travel.id, null)).toBe(false);
	});
});

/** A trip with a shown split (Ana's Hotel) and a hidden one (Fuel), both filed under Ana's Travel. */
async function world() {
	const trip = await seedTrip();
	const { guest, token } = await seedGuest(trip);
	const fuel = await split(
		trip,
		{ createdBy: trip.refs.B, people: [trip.refs.B, trip.refs.C] },
		trip.travel.id,
	);
	await adminDb.splitParticipant.create({
		data: {
			transactionId: fuel.id,
			participantType: "guest",
			participantId: guest.id,
			shareAmount: "1",
			verificationStatus: "PENDING",
		},
	});
	const hotel = trip.expenses.hotel;
	await adminDb.splitParticipant.create({
		data: {
			transactionId: hotel.id,
			participantType: "guest",
			participantId: guest.id,
			shareAmount: "1",
			verificationStatus: "PENDING",
		},
	});
	return { trip, guest, token, fuel, hotel };
}

const guestHeaders = (token: string) => ({ "x-guest-token": token });
/** The context a router sees: the owner's client (a guest has no row level security), and a session for a user. */
const ctxOf = (headers: Record<string, string>, user?: Trip["ana"]["user"]) =>
	({
		db: adminDb,
		session: user
			? {
					user: {
						id: user.id,
						role: user.role,
						email: user.email,
						name: user.name,
						isActive: true,
						protectionState: "OFF",
					},
				}
			: null,
		headers: new Headers(headers),
	}) as never;

describe("the readers that run as the owner", () => {
	it("the public page shows the category on Hotel and none on Fuel, in the rows", async () => {
		const { trip, fuel, hotel } = await world();
		const v = await anonymousCaller().publicPageView({ id: trip.project.id });
		const row = (id: string) => v?.expenses.find((e) => e.id === id);
		expect(row(hotel.id)?.category?.id).toBe(trip.travel.id);
		expect(row(fuel.id)?.category).toBeNull();
	});

	it("a guest's page shows the category on Hotel and none on Fuel, in the rows and by category", async () => {
		const { trip, token, fuel, hotel } = await world();
		const v = await anonymousCaller(guestHeaders(token)).sharedPageView({
			id: trip.project.id,
		});
		const row = (id: string) => v?.expenses.find((e) => e.id === id);
		expect(row(hotel.id)?.category?.id).toBe(trip.travel.id);
		expect(row(fuel.id)?.category).toBeNull();
		// Travel holds Hotel alone; Fuel counts with the uncategorized.
		const travel = v?.byCategory.find((c) => c.id === trip.travel.id);
		expect(travel?.group).toEqual([{ minor: 30000, currency: "BRL" }]);
	});

	it("a viewer link's page does the same", async () => {
		const { trip, fuel, hotel } = await world();
		const linkId = randomUUID();
		await adminDb.magicLink.create({
			data: {
				id: linkId,
				projectId: trip.project.id,
				roleGranted: "VIEWER",
				createdById: trip.ana.user.id,
			},
		});
		const v = await anonymousCaller({ "x-viewer-link-id": linkId }).sharedPageView({
			id: trip.project.id,
		});
		const row = (id: string) => v?.expenses.find((e) => e.id === id);
		expect(row(hotel.id)?.category?.id).toBe(trip.travel.id);
		expect(row(fuel.id)?.category).toBeNull();
	});

	it("a guest's expense list does the same", async () => {
		const { trip, token, fuel, hotel } = await world();
		const r = await anonymousCaller(guestHeaders(token)).listExpenses({
			projectId: trip.project.id,
		});
		const row = (id: string) => r.transactions.find((e) => e.id === id);
		expect(row(hotel.id)?.category?.id).toBe(trip.travel.id);
		expect(row(fuel.id)?.category).toBeNull();
	});

	it("a guest reading one expense does the same", async () => {
		const { token, fuel, hotel, trip } = await world();
		const get = createCallerFactory(sharedTransactionRouter)(ctxOf(guestHeaders(token)));
		expect((await get.getById({ id: hotel.id })).category?.id).toBe(trip.travel.id);
		expect((await get.getById({ id: fuel.id })).category).toBeNull();
	});

	it("a guest reading a billing period does the same", async () => {
		const { trip, token, fuel, hotel } = await world();
		const period = await adminDb.billingPeriod.create({
			data: {
				projectId: trip.project.id,
				label: "Week",
				startDate: new Date("2026-10-01"),
				endDate: new Date("2026-10-31"),
			},
		});
		await adminDb.sharedTransaction.updateMany({
			where: { id: { in: [fuel.id, hotel.id] } },
			data: { billingPeriodId: period.id },
		});
		const detail = await createCallerFactory(billingPeriodRouter)(ctxOf(guestHeaders(token))).detail({
			projectId: trip.project.id,
			periodId: period.id,
		});
		const row = (id: string) => detail.sharedTransactions.find((t) => t.id === id);
		expect(row(hotel.id)?.category?.id).toBe(trip.travel.id);
		expect(row(fuel.id)?.category).toBeNull();
	});

	it("a guest's verification queue does the same", async () => {
		const { token, fuel, hotel, trip } = await world();
		const queue = await createCallerFactory(verificationRouter)(ctxOf(guestHeaders(token))).queue();
		const row = (id: string) => queue.find((q) => q.transaction.id === id);
		expect(row(hotel.id)?.transaction.category?.id).toBe(trip.travel.id);
		expect(row(fuel.id)?.transaction.category).toBeNull();
	});

	it("the audit log names the category on created and edited lines of Hotel and not of Fuel", async () => {
		const { trip, fuel, hotel } = await world();
		const other = await fixtureDb.category.create({
			data: { name: "Beach", color: "blue", userId: trip.ana.user.id },
		});
		for (const target of [hotel, fuel]) {
			await adminDb.auditLogEntry.createMany({
				data: [
					{
						actorType: "user",
						actorId: trip.ben.user.id,
						action: "CREATED",
						targetType: "SHARED_TRANSACTION",
						targetId: target.id,
						projectId: trip.project.id,
						changes: {
							amount: 10,
							currency: "BRL",
							description: "x",
							categoryId: trip.travel.id,
							paidByType: "user",
							paidById: trip.ben.user.id,
							splitParticipants: [],
						},
					},
					{
						actorType: "user",
						actorId: trip.ben.user.id,
						action: "EDITED",
						targetType: "SHARED_TRANSACTION",
						targetId: target.id,
						projectId: trip.project.id,
						timestamp: new Date(Date.now() + 1000),
						changes: { categoryId: { old: trip.travel.id, new: other.id } },
					},
				],
			});
		}
		// Cam is on both splits and does not own the category.
		const history = (id: string) =>
			createCallerFactory(auditLogRouter)(ctxOf({}, trip.cam.user)).transactionHistory({
				transactionId: id,
			});
		const text = async (id: string) => JSON.stringify(await history(id));
		// A category that resolves shows its name (empty when sealed and the log has
		// no key); one that may not be shown gets an empty name, never the id.
		const shown = await text(hotel.id);
		expect(shown).not.toContain(trip.travel.id);
		expect(shown).not.toContain(other.id);
		const hidden = await text(fuel.id);
		expect(hidden).not.toContain(trip.travel.id);
		expect(hidden).not.toContain(other.id);
		expect(hidden).not.toContain("Travel");
		expect(hidden).not.toContain("Beach");
	});
});

describe("the audit log of a hard-deleted split", () => {
	// Ann owns Dining and Beach and filed a split under Dining that she shared with Ben, then deleted it.
	async function deleted() {
		const trip = await seedTrip();
		const dining = await fixtureDb.category.create({
			data: { name: "Dining", color: "teal", userId: trip.ana.user.id },
		});
		const beach = await fixtureDb.category.create({
			data: { name: "Beach", color: "blue", userId: trip.ana.user.id },
		});
		const splitId = randomUUID();
		const snapshot = {
			amount: 10,
			currency: "BRL",
			description: "x",
			categoryId: dining.id,
			paidByType: "user",
			paidById: trip.ana.user.id,
			createdByType: "user",
			createdById: trip.ana.user.id,
			splitParticipants: [
				{ participantType: "user", participantId: trip.ana.user.id, shareAmount: 5 },
				{ participantType: "user", participantId: trip.ben.user.id, shareAmount: 5 },
			],
		};
		const base = {
			actorType: "user" as const,
			actorId: trip.ana.user.id,
			targetType: "SHARED_TRANSACTION" as const,
			targetId: splitId,
			projectId: trip.project.id,
		};
		await adminDb.auditLogEntry.createMany({
			data: [
				{ ...base, action: "CREATED", changes: snapshot },
				{
					...base,
					action: "EDITED",
					timestamp: new Date(Date.now() + 1000),
					changes: { categoryId: { old: dining.id, new: beach.id } },
				},
				{
					...base,
					action: "DELETED",
					timestamp: new Date(Date.now() + 2000),
					changes: snapshot,
				},
			],
		});
		const text = async (user: Trip["ana"]["user"]) =>
			JSON.stringify(
				await createCallerFactory(auditLogRouter)(ctxOf({}, user)).transactionHistory({
					transactionId: splitId,
				}),
			);
		return { trip, dining, beach, text };
	}

	it("shows its owner their own category on the created, edited and deleted lines", async () => {
		const { trip, dining, beach, text } = await deleted();
		const mine = await text(trip.ana.user);
		// A name when the log can open it (empty when sealed); never the id.
		expect(mine).not.toContain(dining.id);
		expect(mine).not.toContain(beach.id);
		// The label is ours: Dining and Beach are named where the suite stores names in plain text.
		if (!sealedSuite) {
			expect(mine).toContain("Dining");
			expect(mine).toContain("Beach");
		}
	});

	it("gives anyone else an empty name and never the id", async () => {
		const { trip, dining, beach, text } = await deleted();
		const theirs = await text(trip.ben.user);
		expect(theirs).not.toContain(dining.id);
		expect(theirs).not.toContain(beach.id);
		expect(theirs).not.toContain("Dining");
		expect(theirs).not.toContain("Beach");
	});

	it("keeps showing the stored id for a category that is gone", async () => {
		const { trip, beach, text } = await deleted();
		await adminDb.category.delete({ where: { id: beach.id } });
		expect(await text(trip.ben.user)).toContain(beach.id);
	});
});
