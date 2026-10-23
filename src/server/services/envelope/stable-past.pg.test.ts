/**
 * The past stays put on Postgres (B7, 02 §3.4, review findings 1 to 3).
 * Expected values by hand:
 *
 * Rate drift. A MDL book from August, rate 40 MDL per USD dated Aug 1.
 * Dining gets MDL 5,000.00 in August; a USD 100 dinner on Aug 12 (no booked
 * home value) is MDL 4,000.00, so Dining carries 100,000 minor. A USD 10
 * lunch on Oct 2 booked at 39 is MDL 390.00 whatever the rates do: Dining
 * 61,000 from October on. The daily sync then moves the one rate row to
 * Nov 3 at 41 (in place): no closed month changes, no revision, no item,
 * and the checkpoint still serves the read. A USD 10 row dated Sep 5 added
 * after that has no rate dated on or before it: left out and listed as a
 * missing rate, never valued at today's 41.
 *
 * Wealth move in August (augustBook, USD): after October's window a
 * 50.00 move to Wealth from Dining dated Aug 20 revises August to October
 * (Dining 15,000, 10,000, 10,000). A stale fingerprint with no mark (a
 * change no trigger saw) is caught on read and the checkpoint rewritten.
 *
 * Late window by when the change was made: an Oct 30 dinner logged Nov 3
 * and first read Nov 10 still updates October in place, with no item.
 */
import { describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { forUser } from "~/server/services/preview";
import { adminDb } from "~/test/pg-harness";
import { Prisma } from "~prisma";
import {
	addRow,
	at,
	augustBook,
	invariantAt,
	seedUser,
	setupInput,
} from "./__tests__/pg-fixture";
import { reconcileMutation, welcomeBackMutation } from "./book.mutation";
import { loadCloseRows } from "./close-rows";
import { computeBook } from "./engine";
import { loadBook } from "./inputs";
import { getMonth, getMonthSummary } from "./read.service";
import { setupEnvelopeBook } from "./setup.mutation";

const row = (m: Awaited<ReturnType<typeof getMonth>>, id: string) =>
	m?.groups.flatMap((g) => g.envelopes).find((e) => e.id === id);

const leftOf = (m: Awaited<ReturnType<typeof getMonth>>, id: string) =>
	m?.groups.flatMap((g) => g.envelopes).find((e) => e.id === id)?.left.minor;

function usdRow(
	userId: string,
	categoryId: string,
	usd: number,
	day: string,
	booked?: { rate: string; amount: string },
) {
	return adminDb.expense.create({
		data: {
			userId,
			title: "Row",
			amount: new Prisma.Decimal(usd),
			currency: "USD",
			date: at(day),
			categoryId,
			amountInUSD: new Prisma.Decimal(usd),
			exchangeRate: new Prisma.Decimal(1),
			pricingSource: "MANUAL",
			...(booked
				? {
						rateType: "official",
						homeCurrency: "MDL",
						homeRate: new Prisma.Decimal(booked.rate),
						homeAmount: new Prisma.Decimal(booked.amount),
					}
				: {}),
		},
	});
}

async function mdlBook(o: { rateOn?: string; rows?: boolean } = {}) {
	const s = await seedUser();
	await adminDb.user.update({
		where: { id: s.user.id },
		data: { homeCurrency: "MDL" },
	});
	// One rate row per pair, as the sync keeps it.
	await adminDb.exchangeRate.deleteMany({
		where: { currency: "MDL", type: "official" },
	});
	const rate = await adminDb.exchangeRate.create({
		data: {
			date: new Date(`${o.rateOn ?? "2026-08-01"}T00:00:00Z`),
			currency: "MDL",
			type: "official",
			rate: 40,
		},
	});
	await forUser(s.user.id).apply(setupEnvelopeBook, {
		...setupInput(s),
		startingMoneyMinor: 0,
		timeZone: "UTC",
	});
	const book = await adminDb.budgetBook.findFirstOrThrow({
		where: { createdById: s.user.id },
		include: { envelopes: true },
	});
	await adminDb.budgetBook.update({
		where: { id: book.id },
		data: { startMonth: 202608, startDate: new Date("2026-08-01T00:00:00Z") },
	});
	await adminDb.bookPeriod.updateMany({
		where: { bookId: book.id },
		data: { fromMonth: 202608 },
	});
	const dining = book.envelopes.find((e) => e.name === "Dining")?.id as string;
	await adminDb.budgetMovement.create({
		data: {
			id: crypto.randomUUID(),
			bookId: book.id,
			month: 202608,
			toEnvelopeId: dining,
			amount: 5000,
			kind: "ASSIGN",
			actorUserId: s.user.id,
		},
	});
	if (o.rows === false)
		return { ...s, bookId: book.id, diningEnv: dining, rateId: rate.id };
	await usdRow(s.user.id, s.dining, 100, "2026-08-12");
	await usdRow(s.user.id, s.dining, 10, "2026-10-02", {
		rate: "39",
		amount: "390",
	});
	return { ...s, bookId: book.id, diningEnv: dining, rateId: rate.id };
}

describe("rates moving in place never move the past (finding 1)", () => {
	it("a sidecar-style rate update changes no closed month, adds no revision or item, and the checkpoint stays valid", async () => {
		const b = await mdlBook();
		const nov3 = await getMonth(b.user.id, undefined, at("2026-11-03"));
		expect(leftOf(nov3, b.diningEnv)).toBe(61_000);
		// The sidecar's daily sync: one row per pair, moved forward in place.
		await adminDb.$executeRaw`UPDATE exchange_rate SET rate = 41, date = ${new Date("2026-11-03T00:00:00Z")} WHERE id = ${b.rateId}`;
		const nov4 = await getMonth(b.user.id, undefined, at("2026-11-04"));
		expect(leftOf(nov4, b.diningEnv)).toBe(61_000);
		const rows = await userTransaction(adminDb, b.user.id, (tx) =>
			loadCloseRows(tx, b.bookId),
		);
		expect(rows.map((r) => [r.revision, r.recalc])).toEqual([
			[1, null],
			[1, null],
			[1, null],
		]);
		const loaded = await userTransaction(adminDb, b.user.id, (tx) =>
			loadBook(tx, b.user.id, { now: at("2026-11-04") }),
		);
		expect(loaded?.checkpoint?.month).toBe(202609);
		// To assign -500,000 + Dining 61,000 = no money in - 439,000 spent.
		await expect(invariantAt(b.user.id, at("2026-11-04"))).resolves.toEqual({
			budget: -439_000,
			ledger: -439_000,
		});
	});

	it("a pair with no rate at all stays missing, never 1", async () => {
		const b = await mdlBook({ rows: false });
		await adminDb.exchangeRate.delete({ where: { id: b.rateId } });
		await usdRow(b.user.id, b.dining, 10, "2026-09-05");
		const m = await getMonth(b.user.id, undefined, at("2026-11-04"));
		expect(m?.incomplete).toBe(true);
		expect(m?.missingRates).toContainEqual({
			currency: "MDL",
			rateType: "official",
			date: "2026-09-05",
		});
	});
});

/**
 * Round 2, finding 1: production keeps one rate row per pair, dated today.
 * A row first read after its day has no rate on or before it: it is valued
 * once at the nearest rate (40 MDL per USD, dated Nov 3), flagged
 * approximate, and never revalued. A pre-M2 USD 100 dinner on Aug 12 is
 * MDL 4,000.00 (400,000); Sam's USD lunch on Aug 12 split 15/15, my share
 * MDL 600.00 (60,000). After the rate moves to 42 on Nov 4 nothing changes.
 */
/**
 * P4 finding (low): rates loaded only from 31 days before the book start.
 * The MDL rate is 40 dated Jun 1 (two months before the Aug 1 start) and 41
 * dated Nov 3. A USD 100 dinner on Aug 12 has a rate on or before it (Jun 1):
 * MDL 4,000.00 (400,000), exact, never the later 41 (410,000, approximate).
 */
describe("a start-month row whose only earlier rate is older than 31 days", () => {
	it("is valued at the latest rate on or before it, not flagged approximate", async () => {
		const b = await mdlBook({ rateOn: "2026-06-01", rows: false });
		await adminDb.exchangeRate.create({
			data: {
				date: new Date("2026-11-03T00:00:00Z"),
				currency: "MDL",
				type: "official",
				rate: 41,
			},
		});
		await usdRow(b.user.id, b.dining, 100, "2026-08-12");
		const nov = await getMonth(b.user.id, undefined, at("2026-11-04"));
		expect(nov?.approximate).toBe(false);
		const frozen = await adminDb.budgetRowValue.findMany({
			where: { bookId: b.bookId },
		});
		expect(
			frozen.map((f) => [
				Number(f.minor),
				f.approximate,
				f.rateDate?.toISOString().slice(0, 10),
			]),
		).toEqual([[400_000, false, "2026-06-01"]]);
	});
});

describe("rows first read after their day are frozen at the nearest rate (round 2)", () => {
	it("a pre-M2 row and Sam's USD share are valued once, approximate, then never move", async () => {
		const b = await mdlBook({ rateOn: "2026-11-03", rows: false });
		await usdRow(b.user.id, b.dining, 100, "2026-08-12");
		const sam = await seedUser();
		await adminDb.sharedTransaction.create({
			data: {
				description: "Lunch",
				amount: new Prisma.Decimal(30),
				currency: "USD",
				date: at("2026-08-12"),
				paidByType: "user",
				paidById: sam.user.id,
				createdByType: "user",
				createdById: sam.user.id,
				splitParticipants: {
					create: [
						{
							participantType: "user",
							participantId: sam.user.id,
							shareAmount: new Prisma.Decimal(15),
							verificationStatus: "ACCEPTED",
						},
						{
							participantType: "user",
							participantId: b.user.id,
							shareAmount: new Prisma.Decimal(15),
							verificationStatus: "ACCEPTED",
						},
					],
				},
			},
		});
		const nov = await getMonth(b.user.id, undefined, at("2026-11-04"));
		expect(nov?.incomplete).toBe(false);
		expect(nov?.approximate).toBe(true);
		const frozen = await adminDb.budgetRowValue.findMany({
			where: { bookId: b.bookId },
			orderBy: { minor: "asc" },
		});
		expect(
			frozen.map((f) => [
				Number(f.minor),
				f.approximate,
				f.rateDate?.toISOString().slice(0, 10),
			]),
		).toEqual([
			[60_000, true, "2026-11-03"],
			[400_000, true, "2026-11-03"],
		]);
		const before = row(nov, b.diningEnv);
		await adminDb.$executeRaw`UPDATE exchange_rate SET rate = 42, date = ${new Date("2026-11-04T00:00:00Z")} WHERE id = ${b.rateId}`;
		const later = await getMonth(b.user.id, undefined, at("2026-11-05"));
		expect(row(later, b.diningEnv)).toEqual(before);
		expect(later?.toAssign).toEqual(nov?.toAssign);
	});

	it("a changed USD value values the row again (finding 2: it is part of the key)", async () => {
		const b = await mdlBook({ rows: false });
		// A BRL 500 dinner booked at USD 100: its book value goes through the USD value.
		const r = await adminDb.expense.create({
			data: {
				userId: b.user.id,
				title: "Row",
				amount: new Prisma.Decimal(500),
				currency: "BRL",
				date: at("2026-08-12"),
				categoryId: b.dining,
				amountInUSD: new Prisma.Decimal(100),
				exchangeRate: new Prisma.Decimal(5),
				pricingSource: "MANUAL",
			},
		});
		await getMonth(b.user.id, undefined, at("2026-11-03"));
		await adminDb.expense.update({
			where: { id: r.id },
			data: { amountInUSD: new Prisma.Decimal(200) },
		});
		const m = await getMonth(b.user.id, undefined, at("2026-11-03"));
		// 200 x 40 = 8,000.00, no longer 100 x 40: August overspends 300,000.
		expect(m?.toAssign.amount.minor).toBe(-800_000);
		const values = await adminDb.budgetRowValue.findMany({
			where: { bookId: b.bookId },
		});
		expect(values.map((v) => Number(v.minor)).sort()).toEqual([
			400_000, 800_000,
		]);
	});
});

describe("closed months a Wealth move reaches are revised (finding 2)", () => {
	it("trigger path: a move to Wealth dated in August revises August to October", async () => {
		const b = await augustBook();
		await getMonth(b.user.id, undefined, at("2026-11-20"));
		await adminDb.wealthTransfer.create({
			data: {
				id: crypto.randomUUID(),
				bookId: b.bookId,
				direction: "TO_WEALTH",
				envelopeId: b.diningEnv,
				date: new Date("2026-08-20T00:00:00Z"),
				amount: 50,
				actorUserId: b.user.id,
			},
		});
		const marks = await adminDb.budgetDirty.findMany({
			where: { bookId: b.bookId },
		});
		expect(marks.map((x) => x.fromMonth)).toEqual([202608]);
		await adminDb.budgetDirty.updateMany({
			where: { bookId: b.bookId },
			data: { createdAt: at("2026-11-20") },
		});
		await getMonth(b.user.id, undefined, at("2026-11-20"));
		const rows = await userTransaction(adminDb, b.user.id, (tx) =>
			loadCloseRows(tx, b.bookId),
		);
		expect(rows.map((r) => r.revision)).toEqual([2, 2, 2]);
		expect(
			rows.map(
				(r) => r.summary.envelopes.find((e) => e.id === b.diningEnv)?.left,
			),
		).toEqual([15_000, 10_000, 10_000]);
	});

	it("fallback path: a stale fingerprint with no mark is caught and its checkpoint rewritten", async () => {
		const b = await augustBook();
		await getMonth(b.user.id, undefined, at("2026-11-20"));
		const aug = await adminDb.monthClose.findFirstOrThrow({
			where: { bookId: b.bookId, month: 202608 },
		});
		const cp = aug.checkpoint as Record<string, unknown>;
		await adminDb.monthClose.update({
			where: { id: aug.id },
			data: { checkpoint: { ...cp, print: "stale" } },
		});
		await getMonth(b.user.id, undefined, at("2026-11-20"));
		await getMonth(b.user.id, undefined, at("2026-11-20"));
		const after = await adminDb.monthClose.findFirstOrThrow({
			where: { id: aug.id },
		});
		expect((after.checkpoint as { print: string }).print).not.toBe("stale");
		expect(after.revision).toBe(1);
		await expect(
			adminDb.budgetDirty.count({ where: { bookId: b.bookId } }),
		).resolves.toBe(0);
	});
});

describe("the late window counts from when the change was made (finding 3)", () => {
	it("an October dinner logged Nov 3 and first read Nov 10 updates October in place", async () => {
		const b = await augustBook();
		await getMonth(b.user.id, undefined, at("2026-11-01"));
		await addRow(
			b.user.id,
			{ amount: 30, categoryId: b.dining },
			at("2026-10-30"),
		);
		await adminDb.budgetDirty.updateMany({
			where: { bookId: b.bookId },
			data: { createdAt: at("2026-11-03") },
		});
		await getMonth(b.user.id, undefined, at("2026-11-10"));
		const oct = await getMonthSummary(b.user.id, 202610, at("2026-11-10"));
		expect(oct?.revision).toBe(1);
		expect(oct?.lateEntries).toBe(1);
		expect(oct?.change).toBeNull();
		expect(oct?.summary.envelopes.find((e) => e.id === b.diningEnv)?.left).toBe(
			12_000,
		);
	});

	it("a month with no late entry says none (null, never 0)", async () => {
		const b = await augustBook();
		await getMonth(b.user.id, undefined, at("2026-11-01"));
		const sep = await getMonthSummary(b.user.id, 202609, at("2026-11-01"));
		expect(sep?.lateEntries).toBeNull();
	});
});

describe("moving a category keeps closed months as they closed (finding 7)", () => {
	// Dining's category moves to Spending on Nov 20: August to October keep
	// Dining 20,000 / 15,000 / 15,000, November still opens with Dining's
	// 15,000 carried, and a Nov 21 dinner (40.00) lands in Spending.
	it("no revision, no change item; new spending follows the new link", async () => {
		const b = await augustBook();
		const now = at("2026-11-20");
		await getMonth(b.user.id, undefined, now);
		const spending = await adminDb.envelope.findFirstOrThrow({
			where: { bookId: b.bookId, name: "Spending" },
		});
		await adminDb.envelopeCategory.updateMany({
			where: { bookId: b.bookId, categoryId: b.dining },
			data: { envelopeId: spending.id },
		});
		await addRow(
			b.user.id,
			{ amount: 40, categoryId: b.dining },
			at("2026-11-21"),
		);
		const nov = await getMonth(b.user.id, undefined, at("2026-11-21"));
		expect(leftOf(nov, b.diningEnv)).toBe(15_000);
		expect(leftOf(nov, spending.id)).toBe(-4_000);
		const rows = await userTransaction(adminDb, b.user.id, (tx) =>
			loadCloseRows(tx, b.bookId),
		);
		expect(rows.map((r) => [r.revision, r.recalc])).toEqual([
			[1, null],
			[1, null],
			[1, null],
		]);
		expect(
			rows.map(
				(r) => r.summary.envelopes.find((e) => e.id === b.diningEnv)?.left,
			),
		).toEqual([20_000, 15_000, 15_000]);
		// A full pass from the start reads the same today.
		const full = await userTransaction(adminDb, b.user.id, (tx) =>
			loadBook(tx, b.user.id, { now: at("2026-11-21"), needFrom: 0 }),
		);
		expect(full?.checkpoint).toBeNull();
		const state = computeBook(full?.input as never);
		expect(state.month(202610).envelopes.get(b.diningEnv)?.left).toBe(15_000);
		expect(state.month(202611).envelopes.get(b.diningEnv)?.left).toBe(15_000);
		await expect(invariantAt(b.user.id, at("2026-11-21"))).resolves.toEqual({
			budget: 81_000,
			ledger: 81_000,
		});
	});
});

describe("round 2: each change is judged against the window, payments mark from paidOn", () => {
	it("one late entry inside the window and one after it: October is revised", async () => {
		const b = await augustBook();
		await getMonth(b.user.id, undefined, at("2026-11-01"));
		await addRow(
			b.user.id,
			{ amount: 30, categoryId: b.dining },
			at("2026-10-30"),
		);
		await adminDb.budgetDirty.updateMany({
			where: { bookId: b.bookId },
			data: { createdAt: at("2026-11-03") },
		});
		await addRow(
			b.user.id,
			{ amount: 20, categoryId: b.dining },
			at("2026-10-29"),
		);
		await adminDb.budgetDirty.updateMany({
			where: { bookId: b.bookId, createdAt: { not: at("2026-11-03") } },
			data: { createdAt: at("2026-11-20") },
		});
		await getMonth(b.user.id, undefined, at("2026-11-20"));
		const oct = await getMonthSummary(b.user.id, 202610, at("2026-11-20"));
		expect(oct?.revision).toBe(2);
		expect(oct?.change).not.toBeNull();
	});

	it("deleting a payment marks from the day it was paid on", async () => {
		const b = await augustBook();
		const friend = await seedUser();
		const id = crypto.randomUUID();
		await adminDb.payment.create({
			data: {
				id,
				payerType: "user",
				payerId: friend.user.id,
				payeeType: "user",
				payeeId: b.user.id,
				amount: new Prisma.Decimal(10),
				currency: "USD",
				paidOn: new Date("2026-08-05T00:00:00Z"),
				recordedByType: "user",
				recordedById: friend.user.id,
			},
		});
		await adminDb.budgetDirty.deleteMany({ where: { bookId: b.bookId } });
		await adminDb.payment.delete({ where: { id } });
		const marks = await adminDb.budgetDirty.findMany({
			where: { bookId: b.bookId },
		});
		expect(marks.map((m) => m.fromMonth)).toEqual([202608]);
	});
});

describe("round 2: reconcile refuses while a rate is missing", () => {
	it("names the currency and records nothing", async () => {
		const b = await mdlBook({ rows: false });
		await adminDb.exchangeRate.delete({ where: { id: b.rateId } });
		await usdRow(b.user.id, b.dining, 10, "2026-08-12");
		const before = await adminDb.expense.count({
			where: { userId: b.user.id },
		});
		await expect(
			forUser(b.user.id).apply(reconcileMutation, {
				id: crypto.randomUUID(),
				bankMinor: 0,
			}),
		).rejects.toThrow("MDL");
		await expect(
			forUser(b.user.id).apply(welcomeBackMutation, {
				choice: "SET_HAVE_NOW",
				id: crypto.randomUUID(),
				amountMinor: 0,
			}),
		).rejects.toThrow("MDL");
		await expect(
			adminDb.expense.count({ where: { userId: b.user.id } }),
		).resolves.toBe(before);
	});
});
