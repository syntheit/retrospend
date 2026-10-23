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
import { loadCloseRows } from "./close-rows";
import { computeBook } from "./engine";
import { loadBook } from "./inputs";
import { getMonth, getMonthSummary } from "./read.service";
import { setupEnvelopeBook } from "./setup.mutation";

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

async function mdlBook() {
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
			date: new Date("2026-08-01T00:00:00Z"),
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

	it("a row with no frozen value and no rate dated on or before it is a missing rate, never today's", async () => {
		const b = await mdlBook();
		await adminDb.$executeRaw`UPDATE exchange_rate SET rate = 41, date = ${new Date("2026-11-03T00:00:00Z")} WHERE id = ${b.rateId}`;
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
