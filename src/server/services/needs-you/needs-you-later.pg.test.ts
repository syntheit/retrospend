/**
 * Later (snooze), Owed for 60 days and shares that need an envelope on a
 * real Postgres, worked out by hand. "Now" is 2026-10-24 12:00 in Buenos
 * Aires (15:00Z); Later hides an item until the start of her next day,
 * 2026-10-25 00:00 -03:00 = 03:00Z.
 *
 * Lola's book starts in August (USD, Flex):
 * - Paz (not on Retrospend) owes her USD 120 from a dinner she paid for on
 *   2026-08-05: 80 days open on Oct 24, no payment since -> Owed for 60 days.
 * - Tomás owes her USD 30 from Sep 20 (34 days): not aging.
 * - Martín added her to a USD 45 dinner on Oct 20 with no category for her
 *   share: one share that needs an envelope.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { homeRouter } from "~/server/api/routers/home";
import { createCallerFactory } from "~/server/api/trpc";
import { userTransaction } from "~/server/db-tx";
import { augustBook } from "~/server/services/envelope/__tests__/pg-fixture";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { needsYou } from "./index";
import { snooze, snoozeIn, unsnooze } from "./snooze";

const NOW = new Date("2026-10-24T15:00:00Z");
const ZONE = "America/Argentina/Buenos_Aires";
const opts = {
	budget: true,
	timeZone: ZONE,
	now: NOW,
	emailEnabled: false,
} as const;
const HOUR = 3_600_000;

function split(
	payer: { type: "user" | "shadow"; id: string },
	other: { type: "user" | "shadow"; id: string },
	amount: string,
	date: string,
	debtor: "payer" | "other",
) {
	const owes = debtor === "other" ? other : payer;
	const holder = debtor === "other" ? payer : other;
	return adminDb.sharedTransaction.create({
		data: {
			description: "Dinner",
			amount,
			currency: "USD",
			date: new Date(date),
			paidByType: payer.type,
			paidById: payer.id,
			createdByType: payer.type,
			createdById: payer.id,
			splitParticipants: {
				create: [
					{
						participantType: owes.type,
						participantId: owes.id,
						shareAmount: amount,
						verificationStatus: "ACCEPTED",
					},
					{
						participantType: holder.type,
						participantId: holder.id,
						shareAmount: "0",
						verificationStatus: "ACCEPTED",
					},
				],
			},
		},
	});
}

let lola: Awaited<ReturnType<typeof augustBook>>;
let pazId: string;
let tomasId: string;
let martinId: string;
let dueId: string;

beforeAll(async () => {
	lola = await augustBook();
	const me = { type: "user", id: lola.user.id } as const;
	pazId = (
		await adminDb.shadowProfile.create({
			data: { createdById: lola.user.id, name: "Paz" },
		})
	).id;
	tomasId = (
		await adminDb.shadowProfile.create({
			data: { createdById: lola.user.id, name: "Tomás" },
		})
	).id;
	martinId = (await createTestUser()).user.id;
	await split(
		me,
		{ type: "shadow", id: pazId },
		"120",
		"2026-08-05T15:00:00Z",
		"other",
	);
	await split(
		me,
		{ type: "shadow", id: tomasId },
		"30",
		"2026-09-20T15:00:00Z",
		"other",
	);
	await split(
		{ type: "user", id: martinId },
		me,
		"45",
		"2026-10-20T15:00:00Z",
		"other",
	);
	dueId = (
		await adminDb.recurringTemplate.create({
			data: {
				userId: lola.user.id,
				name: "Gym",
				amount: "20",
				currency: "USD",
				frequency: "MONTHLY",
				nextDueDate: new Date(NOW.getTime() - HOUR),
				autoPay: false,
				amountMode: "FIXED",
				direction: "OUT",
				isActive: true,
			},
		})
	).id;
});

describe("Owed for 60 days", () => {
	it("Paz, 80 days open with no payment, is one People item; Tomás, 34 days, is not", async () => {
		const list = await needsYou(adminDb, lola.user.id, opts);
		const aging = list.items.filter((i) => i.type === "people.owedAging");
		expect(aging).toHaveLength(1);
		expect(aging[0]).toMatchObject({
			id: `people.owedAging:shadow:${pazId}`,
			group: "people",
			entity: { kind: "person", id: `shadow:${pazId}` },
			people: [`shadow:${pazId}`],
			amount: { minor: 12_000, currency: "USD" },
			date: "2026-08-05",
			attention: true,
		});
		expect(list.people[`shadow:${pazId}`]).toMatchObject({
			name: "Paz",
			onRetrospend: false,
		});
		expect(list.counts.people).toBeGreaterThanOrEqual(1);
	});

	it("a payment from Paz in the last 60 days quiets it", async () => {
		const quiet = await augustBook();
		const me = { type: "user", id: quiet.user.id } as const;
		const paz = await adminDb.shadowProfile.create({
			data: { createdById: quiet.user.id, name: "Paz" },
		});
		await split(
			me,
			{ type: "shadow", id: paz.id },
			"120",
			"2026-08-05T15:00:00Z",
			"other",
		);
		const group = randomUUID();
		await adminDb.payment.create({
			data: {
				id: group,
				payerType: "shadow",
				payerId: paz.id,
				payeeType: "user",
				payeeId: quiet.user.id,
				amount: "20",
				currency: "USD",
				paidOn: new Date("2026-10-10T15:00:00Z"),
				recordedByType: "user",
				recordedById: quiet.user.id,
				status: "FINALIZED",
			},
		});
		await adminDb.settlement.create({
			data: {
				fromParticipantType: "shadow",
				fromParticipantId: paz.id,
				toParticipantType: "user",
				toParticipantId: quiet.user.id,
				amount: "20",
				currency: "USD",
				status: "FINALIZED",
				confirmedByPayer: true,
				confirmedByPayee: true,
				settledAt: new Date("2026-10-10T15:00:00Z"),
				paymentGroupId: group,
			},
		});
		const list = await needsYou(adminDb, quiet.user.id, opts);
		expect(list.items.some((i) => i.type === "people.owedAging")).toBe(false);
	});
});

describe("Shares that need an envelope", () => {
	it("Martín's USD 45 dinner with no category is one item with a count of 1", async () => {
		const list = await needsYou(adminDb, lola.user.id, opts);
		const item = list.items.find((i) => i.type === "budget.sharesNeedEnvelope");
		expect(item).toMatchObject({
			id: "budget.sharesNeedEnvelope",
			group: "budget",
			entity: { kind: "book", id: expect.any(String) },
			count: 1,
			actions: [{ entity: "budget", id: "pickEnvelope" }],
		});
	});

	it("with the budget off neither budget item shows", async () => {
		const list = await needsYou(adminDb, lola.user.id, {
			...opts,
			budget: false,
		});
		expect(list.items.some((i) => i.type === "budget.sharesNeedEnvelope")).toBe(
			false,
		);
		expect(list.items.some((i) => i.type === "people.owedAging")).toBe(false);
	});
});

describe("Later", () => {
	const dueItem = () => `recurring.due:${dueId}`;
	const ids = async (now = NOW) =>
		(await needsYou(adminDb, lola.user.id, { ...opts, now })).items.map(
			(i) => i.id,
		);

	it("hides the item and its count until the start of her next day", async () => {
		expect(await ids()).toContain(dueItem());
		const before = (await needsYou(adminDb, lola.user.id, opts)).counts;
		const done = await snooze(
			adminDb,
			lola.user.id,
			{ id: randomUUID(), itemId: dueItem() },
			{ timeZone: ZONE, now: NOW },
		);
		expect(done.until.toISOString()).toBe("2026-10-25T03:00:00.000Z");
		const after = await needsYou(adminDb, lola.user.id, opts);
		expect(after.items.map((i) => i.id)).not.toContain(dueItem());
		expect(after.counts.activity).toBe(before.activity - 1);
		expect(after.counts.total).toBe(before.total - 1);
		// Tomorrow morning, in her zone, it is back, now overdue (its id says so).
		expect(await ids(new Date("2026-10-25T03:00:01Z"))).toContain(
			`recurring.overdue:${dueId}`,
		);
		// Just before, it is still out.
		expect(await ids(new Date("2026-10-25T02:59:59Z"))).not.toContain(
			dueItem(),
		);
	});

	it("Undo brings it back now, and Later twice is one row", async () => {
		await snooze(
			adminDb,
			lola.user.id,
			{ id: randomUUID(), itemId: dueItem() },
			{ timeZone: ZONE, now: NOW },
		);
		await snooze(
			adminDb,
			lola.user.id,
			{ id: randomUUID(), itemId: dueItem() },
			{ timeZone: ZONE, now: NOW },
		);
		expect(
			await adminDb.needsYouSnooze.count({
				where: { userId: lola.user.id, itemId: dueItem() },
			}),
		).toBe(1);
		await unsnooze(adminDb, lola.user.id, { itemId: dueItem() });
		expect(await ids()).toContain(dueItem());
	});

	it("rows that already ended are cleaned on the next Later", async () => {
		const { user } = await createTestUser();
		await adminDb.needsYouSnooze.create({
			data: {
				id: randomUUID(),
				userId: user.id,
				itemId: "split.review:old",
				until: new Date("2026-10-01T00:00:00Z"),
			},
		});
		await userTransaction(adminDb, user.id, (tx) =>
			snoozeIn(
				tx,
				user.id,
				{ id: randomUUID(), itemId: "import.review" },
				{ now: NOW, timeZone: ZONE },
			),
		);
		const left = await adminDb.needsYouSnooze.findMany({
			where: { userId: user.id },
		});
		expect(left.map((r) => r.itemId)).toEqual(["import.review"]);
	});

	it("RLS: one person's Later never hides, or shows, another's", async () => {
		const other = await createTestUser();
		await snooze(
			adminDb,
			lola.user.id,
			{ id: randomUUID(), itemId: dueItem() },
			{ timeZone: ZONE, now: NOW },
		);
		const seen = await userTransaction(adminDb, other.user.id, (tx) =>
			tx.needsYouSnooze.findMany(),
		);
		expect(seen).toEqual([]);
		await unsnooze(adminDb, lola.user.id, { itemId: dueItem() });
	});
});

describe("home router", () => {
	const caller = (user: { id: string }) =>
		createCallerFactory(homeRouter)({
			session: { user: { ...user, role: "USER", isActive: true } },
			db: adminDb,
			headers: new Headers({ "x-timezone": ZONE }),
		} as never);

	it("snoozeNeedsYou and unsnoozeNeedsYou move an item out of and back into needsYou", async () => {
		const { user } = await createTestUser();
		await adminDb.user.update({
			where: { id: user.id },
			data: { emailVerified: true },
		});
		const t = await adminDb.recurringTemplate.create({
			data: {
				userId: user.id,
				name: "Rent",
				amount: "500",
				currency: "USD",
				frequency: "MONTHLY",
				nextDueDate: new Date(Date.now() - 3 * 24 * HOUR),
				autoPay: false,
				amountMode: "FIXED",
				direction: "OUT",
				isActive: true,
			},
		});
		const c = caller(user);
		const itemId = `recurring.overdue:${t.id}`;
		expect((await c.needsYou()).items.map((i) => i.id)).toContain(itemId);
		const done = await c.snoozeNeedsYou({ id: randomUUID(), itemId });
		expect(done.itemId).toBe(itemId);
		expect((await c.needsYou()).items.map((i) => i.id)).not.toContain(itemId);
		await c.unsnoozeNeedsYou({ itemId });
		expect((await c.needsYou()).items.map((i) => i.id)).toContain(itemId);
	});

	it("refuses an id that is not an item id", async () => {
		const { user } = await createTestUser();
		await expect(
			caller(user).snoozeNeedsYou({ id: randomUUID(), itemId: "drop table" }),
		).rejects.toThrow();
	});
});
