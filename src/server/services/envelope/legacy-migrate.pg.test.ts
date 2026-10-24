/**
 * The legacy budget to Limits move on a real Postgres (RLS on), values by
 * hand. Pseudo currencies keep the shared run database clean: XTF is a
 * foreign currency at 900 per USD, XTH a home currency whose "official" rate
 * is 900 and "blue" rate 1,200 per USD, XTM has no rate at all.
 *
 * Ana (USD home): Rent 1,200.00 (fixed category), Groceries 400.00, Dining
 * pegged to actual, Transport pegged to last month, Fun XTF 90,000.00 (100.00
 * USD), global 3,000.00; Gifts has no budget. Dining spent 87.50, Groceries
 * 120.00 and Gifts 30.00 this month, Transport 65.00 last month.
 *   Everything else = 3,000.00 - (1,200.00 + 400.00 + 65.00 + 100.00) = 1,235.00
 *   funded: 1,200 + 400 + 87.50 + 65 + 100 + 1,235 = 3,087.50 (the old total:
 *   global 3,000.00 + pegged spending 87.50)
 *   left: 1,200 + 280 + 0 + 65 + 100 + 1,205 = 2,850.00 in her limits.
 *
 * Beto (XTH home, blue rate first favorite): Rent USD 100.00 = 120,000.00
 * XTH at blue 1,200; Groceries XTH 150,000.00; funded 270,000.00 XTH.
 *
 * Cris: Dining 200.00 and Rent 500.00; Dining spent 150.00 and 60.00 hidden
 * from reports this month (plus 40.00 hidden last month, before the book).
 *   Dining left 200 - 210 = -10.00; Not spending on the hidden row: 50.00.
 */
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import { beforeAll, describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { needsYouIn } from "~/server/services/needs-you";
import { forUser } from "~/server/services/preview";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { Prisma } from "~prisma";
import { addRow, at, invariantAt } from "./__tests__/pg-fixture";
import { addMonths } from "./calendar";
import { envelopeExportFiles } from "./envelope-export";
import { migrateUsers, rollbackRun } from "./legacy-migrate.batch";
import { ensureLegacyBook } from "./legacy-migrate.service";
import {
	resolveHiddenMutation,
	revertHiddenMutation,
} from "./migration.mutation";
import {
	dismissMigrationNotice,
	getEnvelopeExport,
	getHiddenRows,
	getMigrationState,
	getPacing,
} from "./migration-read.service";
import { budgetMonthOf, isoDateIn } from "./months";
import { getMonth } from "./read.service";

type Kind = "FIXED" | "PEG_TO_ACTUAL" | "PEG_TO_LAST_MONTH";
const D = (v: number | string) => new Prisma.Decimal(v);
const today = new Date().toISOString().slice(0, 10);
const current = budgetMonthOf(isoDateIn(new Date(), "UTC"), [
	{ fromMonth: 0, startDay: 1 },
]);
const last = addMonths(current, -1);
const mid = (m: number) =>
	at(`${Math.floor(m / 100)}-${String(m % 100).padStart(2, "0")}-15`);
/** What the old server wrote: midnight on the 1st in its own zone. */
const period = (m: number) => new Date(Math.floor(m / 100), (m % 100) - 1, 1);

async function person(home = "USD") {
	const t = await createTestUser();
	await adminDb.user.update({
		where: { id: t.user.id },
		data: { homeCurrency: home, timeZone: "UTC", fiscalMonthStartDay: 1 },
	});
	const cat = (name: string, isFixed = false) =>
		adminDb.category
			.create({
				data: { name, color: "blue", icon: "tag", isFixed, userId: t.user.id },
			})
			.then((c) => c.id);
	return { ...t, cat };
}

function budget(
	userId: string,
	b: {
		categoryId: string | null;
		amount?: number | string;
		currency?: string;
		type?: Kind;
		month?: number;
	},
) {
	return adminDb.budget.create({
		data: {
			userId,
			categoryId: b.categoryId,
			amount: D(b.amount ?? 0),
			currency: b.currency ?? "USD",
			type: b.type ?? "FIXED",
			period: period(b.month ?? current),
		},
	});
}

const rate = (currency: string, type: string, value: number) =>
	adminDb.exchangeRate.upsert({
		where: {
			date_currency_type: {
				date: new Date(`${today}T00:00:00Z`),
				currency,
				type,
			},
		},
		create: {
			date: new Date(`${today}T00:00:00Z`),
			currency,
			type,
			rate: D(value),
		},
		update: { rate: D(value) },
	});

const apply = (userId: string, runId = `test-${randomUUID()}`) =>
	migrateUsers(adminDb, { apply: true, userIds: [userId], runId });

const bookOf = (userId: string) =>
	adminDb.budgetBook.findFirstOrThrow({
		where: { createdById: userId },
		include: { envelopes: { include: { categories: true } }, groups: true },
	});

const row = (m: Awaited<ReturnType<typeof getMonth>>, name: string) =>
	m?.groups.flatMap((g) => g.envelopes).find((e) => e.name === name);

beforeAll(async () => {
	await rate("XTF", "official", 900);
	await rate("XTH", "official", 900);
	await rate("XTH", "blue", 1200);
});

describe("Ana: five category budgets, a global one and a foreign one", () => {
	let ana: Awaited<ReturnType<typeof person>>;
	let runId: string;
	let report: Awaited<ReturnType<typeof apply>>["reports"][number];
	let before: { budgets: number; books: number };

	beforeAll(async () => {
		ana = await person();
		const [rent, groc, dine, tran, fun, gift] = await Promise.all([
			ana.cat("Rent", true),
			ana.cat("Groceries"),
			ana.cat("Dining"),
			ana.cat("Transport"),
			ana.cat("Fun"),
			ana.cat("Gifts"),
		]);
		await budget(ana.user.id, { categoryId: rent, amount: "1200.00" });
		await budget(ana.user.id, { categoryId: groc, amount: "400.00" });
		await budget(ana.user.id, { categoryId: dine, type: "PEG_TO_ACTUAL" });
		await budget(ana.user.id, { categoryId: tran, type: "PEG_TO_LAST_MONTH" });
		await budget(ana.user.id, {
			categoryId: fun,
			amount: "90000.00",
			currency: "XTF",
		});
		await budget(ana.user.id, { categoryId: null, amount: "3000.00" });
		// An older month the migration must ignore: the current month has rows.
		await budget(ana.user.id, {
			categoryId: rent,
			amount: "999.00",
			month: last,
		});
		await addRow(ana.user.id, { amount: 87.5, categoryId: dine });
		await addRow(ana.user.id, { amount: 120, categoryId: groc });
		await addRow(ana.user.id, { amount: 30, categoryId: gift });
		await addRow(ana.user.id, { amount: 65, categoryId: tran }, mid(last));
		before = {
			budgets: await adminDb.budget.count({ where: { userId: ana.user.id } }),
			books: await adminDb.budgetBook.count(),
		};
		const run = await apply(ana.user.id);
		runId = run.runId;
		report = run.reports[0] as typeof report;
	});

	it("reports the move: counts, old total and funding in home currency, no missing rates", () => {
		expect(report).toMatchObject({
			status: "MIGRATED",
			currency: "USD",
			sourceIsEarlier: false,
			envelopes: 6,
			fixed: 3,
			pegToActual: 1,
			pegToLastMonth: 1,
			global: true,
			beforeMinor: 308_750,
			fundedMinor: 308_750,
			funded: true,
			invariantOk: true,
			hiddenRows: 0,
			missingRates: [],
			left: [],
			warnings: [],
		});
	});

	it("opens to a funded Limits month with every envelope at its limit", async () => {
		const book = await bookOf(ana.user.id);
		expect(book).toMatchObject({
			style: "LIMITS",
			fundingSource: "TARGETS",
			currency: "USD",
			legacyMigrationRunId: runId,
			timeZoneConfirmed: false,
		});
		expect(book.legacyMigratedAt).not.toBeNull();
		expect(book.groups.map((g) => g.name).sort()).toEqual([
			"Bills",
			"Everyday",
		]);
		const m = await getMonth(ana.user.id, undefined, new Date(), "UTC");
		const assigned = (n: string) => row(m, n)?.assigned.minor;
		expect(assigned("Rent")).toBe(120_000);
		expect(assigned("Groceries")).toBe(40_000);
		expect(assigned("Dining")).toBe(8_750);
		expect(assigned("Transport")).toBe(6_500);
		expect(assigned("Fun")).toBe(10_000);
		expect(assigned("Everything else")).toBe(123_500);
		expect(row(m, "Dining")?.left.minor).toBe(0);
		expect(row(m, "Groceries")?.left.minor).toBe(28_000);
		expect(row(m, "Everything else")?.left.minor).toBe(120_500);
		expect(m?.verdict.lead).toMatchObject({
			kind: "LEFT_IN_LIMITS",
			amount: { minor: 285_000, currency: "USD" },
		});
		expect(m?.verdict.limits).toEqual({
			limit: { minor: 308_750, currency: "USD" },
			spent: { minor: 23_750, currency: "USD" },
		});
		expect(m?.incomplete).toBe(false);
	});

	it("keeps the foreign limit in its own currency, copies icon and color, links the rest to Everything else", async () => {
		const book = await bookOf(ana.user.id);
		const fun = book.envelopes.find((e) => e.name === "Fun");
		expect(fun).toMatchObject({
			targetCurrency: "XTF",
			targetMode: "SET_ASIDE",
			leftoverRule: "RETURN",
			color: "blue",
			icon: "tag",
		});
		expect(fun?.targetAmount?.toString()).toBe("90000");
		const other = book.envelopes.find((e) => e.id === book.defaultEnvelopeId);
		expect(other?.name).toBe("Everything else");
		expect(other?.categories).toHaveLength(1);
		const dining = book.envelopes.find((e) => e.name === "Dining");
		expect(dining).toMatchObject({ kind: "NONE", targetAmount: null });
		const rent = book.envelopes.find((e) => e.name === "Rent");
		const bills = book.groups.find((g) => g.name === "Bills");
		expect(rent?.groupId).toBe(bills?.id);
		expect(bills?.role).toBe("BILLS");
	});

	it("running it again, by script or by a read, changes nothing; the old rows stay", async () => {
		const snapshot = async () => ({
			books: await adminDb.budgetBook.count({
				where: { createdById: ana.user.id },
			}),
			envelopes: await adminDb.envelope.count({
				where: { book: { createdById: ana.user.id } },
			}),
			movements: await adminDb.budgetMovement.count({
				where: { book: { createdById: ana.user.id } },
			}),
			budgets: await adminDb.budget.count({ where: { userId: ana.user.id } }),
		});
		const first = await snapshot();
		const again = await migrateUsers(adminDb, {
			apply: true,
			userIds: [ana.user.id],
		});
		expect(again.reports.map((r) => r.status)).toEqual(["HAS_BOOK"]);
		await getMonth(ana.user.id);
		await userTransaction(adminDb, ana.user.id, (tx) =>
			ensureLegacyBook(tx, ana.user.id, new Date(), null),
		);
		expect(await snapshot()).toEqual(first);
		expect(first.budgets).toBe(before.budgets);
		expect(await adminDb.budgetBook.count()).toBe(before.books + 1);
	});

	it("the dashboard pace reads envelope totals: 3,087.50 available, 237.50 spent", async () => {
		const p = await getPacing(ana.user.id, new Date(), "UTC");
		expect(p?.total).toEqual({
			budget: { minor: 308_750, currency: "USD" },
			spent: { minor: 23_750, currency: "USD" },
		});
		// Rent sits in Bills: the variable part is everything else.
		expect(p?.variable).toEqual({
			budget: { minor: 188_750, currency: "USD" },
			spent: { minor: 23_750, currency: "USD" },
		});
	});

	it("exports envelopes, movements, rules and months", async () => {
		const files = await envelopeExportFiles(adminDb, ana.user.id);
		expect(files.map((f) => f.name)).toEqual([
			"envelopes.csv",
			"movements.csv",
			"rules.json",
			"months.json",
		]);
		const lines = (n: string) =>
			files.find((f) => f.name === n)?.content.split("\n") ?? [];
		expect(lines("envelopes.csv")).toHaveLength(7);
		expect(lines("movements.csv")).toHaveLength(7);
		expect(lines("movements.csv")[0]).toContain("fromEnvelope");
		expect(lines("envelopes.csv").find((l) => l.includes("Fun"))).toContain(
			"XTF",
		);
		const months = JSON.parse(
			files.find((f) => f.name === "months.json")?.content ?? "{}",
		);
		expect(months.book).toMatchObject({ currency: "USD", style: "LIMITS" });
		expect(
			JSON.parse(files.find((f) => f.name === "rules.json")?.content ?? "{}")
				.rules,
		).toEqual([]);
	});

	it("serves the same files as one ZIP named by the day, and nothing without a book", async () => {
		const out = await getEnvelopeExport(
			ana.user.id,
			"UTC",
			new Date("2026-10-24T12:00:00Z"),
		);
		expect(out.filename).toBe("retrospend-budget-2026-10-24.zip");
		const zip = await JSZip.loadAsync(out.zipData ?? "", { base64: true });
		expect(Object.keys(zip.files).sort()).toEqual([
			"envelopes.csv",
			"months.json",
			"movements.csv",
			"rules.json",
		]);
		const none = await person();
		const empty = await getEnvelopeExport(none.user.id, "UTC");
		expect(empty).toMatchObject({ files: [], zipData: null });
	});
});

describe("a dry run writes nothing and reports what an apply would", () => {
	it("is the same report, and no book", async () => {
		const p = await person();
		const rent = await p.cat("Rent", true);
		await budget(p.user.id, { categoryId: rent, amount: "500.00" });
		const dry = await migrateUsers(adminDb, {
			apply: false,
			userIds: [p.user.id],
		});
		expect(
			await adminDb.budgetBook.count({ where: { createdById: p.user.id } }),
		).toBe(0);
		expect(
			await adminDb.budgetMovement.count({ where: { actorUserId: p.user.id } }),
		).toBe(0);
		const done = await migrateUsers(adminDb, {
			apply: true,
			userIds: [p.user.id],
		});
		expect(dry.reports).toEqual(done.reports);
		expect(done.reports[0]).toMatchObject({
			status: "MIGRATED",
			currency: "USD",
			envelopes: 2,
			fixed: 1,
			beforeMinor: 50_000,
			fundedMinor: 50_000,
			funded: true,
			invariantOk: true,
			missingRates: [],
			warnings: [],
		});
	});
});

describe("Beto: a home currency with a blue rate", () => {
	it("sizes a USD limit at the blue rate and keeps its currency", async () => {
		const b = await person("XTH");
		const blue = await adminDb.exchangeRate.findFirstOrThrow({
			where: { currency: "XTH", type: "blue" },
		});
		await adminDb.exchangeRateFavorite.create({
			data: { userId: b.user.id, exchangeRateId: blue.id, order: 0 },
		});
		const rent = await b.cat("Rent", true);
		const groc = await b.cat("Groceries");
		await budget(b.user.id, {
			categoryId: rent,
			amount: "100.00",
			currency: "USD",
		});
		await budget(b.user.id, {
			categoryId: groc,
			amount: "150000.00",
			currency: "XTH",
		});
		const { reports } = await apply(b.user.id);
		expect(reports[0]).toMatchObject({
			status: "MIGRATED",
			currency: "XTH",
			beforeMinor: 27_000_000,
			fundedMinor: 27_000_000,
			warnings: [],
		});
		const book = await bookOf(b.user.id);
		const periods = await adminDb.bookPeriod.findMany({
			where: { bookId: book.id },
		});
		expect(periods.map((p) => p.rateType)).toEqual(["blue"]);
		const m = await getMonth(b.user.id, undefined, new Date(), "UTC");
		expect(row(m, "Rent")?.assigned).toEqual({
			minor: 12_000_000,
			currency: "XTH",
		});
		expect(row(m, "Groceries")?.assigned.minor).toBe(15_000_000);
	});
});

/**
 * Dara (USD home, no global budget): Groceries 400.00 fixed, Dining pegged to
 * actual, Gifts has no budget. This month Dining 87.50, Gifts 40.00 and
 * Groceries 500.00 (really 100.00 over). Next month Dining 80.00 and Gifts
 * 25.00.
 *   A pegged or unlimited envelope has no limit to exceed: Dining and
 *   Everything else show their spending as negative Left but are never
 *   "over", in month 1 or month 2. Only Groceries is over (-100.00), and only
 *   in month 1; month 2 funds it 400.00 again and it is untouched.
 */
describe("Dara: pegged and unlimited envelopes are never overspent", () => {
	const nextMonth = addMonths(current, 1);
	const nextNoon = new Date(
		Date.UTC(Math.floor(nextMonth / 100), (nextMonth % 100) - 1, 5, 12),
	);
	let dara: Awaited<ReturnType<typeof person>>;
	let ids: Record<string, string>;

	beforeAll(async () => {
		dara = await person();
		const [groc, dine, gift] = await Promise.all([
			dara.cat("Groceries"),
			dara.cat("Dining"),
			dara.cat("Gifts"),
		]);
		await budget(dara.user.id, { categoryId: groc, amount: "400.00" });
		await budget(dara.user.id, { categoryId: dine, type: "PEG_TO_ACTUAL" });
		await addRow(dara.user.id, { amount: 87.5, categoryId: dine });
		await addRow(dara.user.id, { amount: 40, categoryId: gift });
		await addRow(dara.user.id, { amount: 500, categoryId: groc });
		await addRow(dara.user.id, { amount: 80, categoryId: dine }, nextNoon);
		await addRow(dara.user.id, { amount: 25, categoryId: gift }, nextNoon);
		await apply(dara.user.id);
		const book = await bookOf(dara.user.id);
		ids = Object.fromEntries(book.envelopes.map((e) => [e.name, e.id]));
		expect(book.envelopes.find((e) => e.name === "Everything else")?.kind).toBe(
			"NONE",
		);
	});

	const items = (now: Date) =>
		userTransaction(adminDb, dara.user.id, (tx) =>
			needsYouIn(tx, dara.user.id, { budget: true, timeZone: "UTC", now }),
		).then((l) => l.items.filter((i) => i.type === "budget.overspent"));

	it("month 1: only Groceries is over", async () => {
		const m = await getMonth(dara.user.id, undefined, new Date(), "UTC");
		expect(m?.verdict.overEnvelopes).toEqual([
			{ id: ids.Groceries, over: { minor: 10_000, currency: "USD" } },
		]);
		expect(row(m, "Everything else")).toMatchObject({
			left: { minor: -4_000, currency: "USD" },
			status: "NO_TARGET",
		});
		const over = await items(new Date());
		expect(over).toHaveLength(1);
		expect(over[0]?.entityIds).toEqual([ids.Groceries]);
	});

	it("month 2: spending in a pegged envelope and Everything else raises nothing", async () => {
		const m = await getMonth(dara.user.id, undefined, nextNoon, "UTC");
		expect(row(m, "Dining")).toMatchObject({
			left: { minor: -8_000, currency: "USD" },
			status: "NO_TARGET",
		});
		expect(row(m, "Everything else")?.left.minor).toBe(-2_500);
		expect(row(m, "Groceries")?.left.minor).toBe(40_000);
		expect(m?.verdict.overEnvelopes).toEqual([]);
		expect(m?.verdict.state).not.toBe("SOME_OVER");
		expect(await items(nextNoon)).toEqual([]);
	});

	it("the invariant holds in both months", async () => {
		for (const now of [new Date(), nextNoon]) {
			const s = await invariantAt(dara.user.id, now);
			expect(s.budget).toBe(s.ledger);
		}
	});
});

describe("Cris: rows the old budget hid", () => {
	let cris: Awaited<ReturnType<typeof person>>;
	let hidden: string;
	let dining: string;

	beforeAll(async () => {
		cris = await person();
		dining = await cris.cat("Dining");
		const rent = await cris.cat("Rent", true);
		await budget(cris.user.id, { categoryId: dining, amount: "200.00" });
		await budget(cris.user.id, { categoryId: rent, amount: "500.00" });
		await addRow(cris.user.id, { amount: 150, categoryId: dining });
		hidden = (
			await addRow(cris.user.id, {
				amount: 60,
				categoryId: dining,
				excludeFromAnalytics: true,
			})
		).id;
		await addRow(
			cris.user.id,
			{ amount: 40, categoryId: dining, excludeFromAnalytics: true },
			mid(last),
		);
		await apply(cris.user.id);
	});

	const left = async () =>
		row(await getMonth(cris.user.id, undefined, new Date(), "UTC"), "Dining")
			?.left.minor;

	it("counts the hidden row until answered, lists it, and raises one Needs you item", async () => {
		expect(await left()).toBe(-1_000);
		const rows = await getHiddenRows(cris.user.id);
		expect(rows.currency).toBe("USD");
		expect(rows.rows).toHaveLength(1);
		expect(rows.rows[0]).toMatchObject({
			id: hidden,
			amount: { minor: 6_000, currency: "USD" },
			categoryId: dining,
		});
		expect(await getMigrationState(cris.user.id)).toEqual({
			migrated: true,
			noticeOpen: true,
			hiddenRows: 1,
		});
		const list = await userTransaction(adminDb, cris.user.id, (tx) =>
			needsYouIn(tx, cris.user.id, { budget: true, timeZone: "UTC" }),
		);
		const item = list.items.find((i) => i.type === "budget.hiddenReview");
		expect(item).toMatchObject({ count: 1, group: "budget" });
	});

	it("Not spending takes it out of the budget, previews first, and undoes", async () => {
		const answers = [{ id: hidden, answer: "NOT_SPENDING" as const }];
		const p = await forUser(cris.user.id).preview(resolveHiddenMutation, {
			answers,
		});
		expect(p.value.notSpending).toEqual([hidden]);
		expect(await left()).toBe(-1_000);
		const done = await forUser(cris.user.id).apply(resolveHiddenMutation, {
			answers,
		});
		expect(await left()).toBe(5_000);
		expect((await getHiddenRows(cris.user.id)).rows).toEqual([]);
		expect(done.undo).toMatchObject({ mutation: "envelope.revertHidden" });
		await forUser(cris.user.id).apply(revertHiddenMutation, {
			spending: [],
			notSpending: [hidden],
		});
		expect(await left()).toBe(-1_000);
		expect((await getHiddenRows(cris.user.id)).rows).toHaveLength(1);
	});

	it("Spending shows the row in reports and keeps the budget as it counted", async () => {
		await forUser(cris.user.id).apply(resolveHiddenMutation, {
			answers: [{ id: hidden, answer: "SPENDING" }],
		});
		expect(await left()).toBe(-1_000);
		expect(
			await adminDb.expense.findUniqueOrThrow({ where: { id: hidden } }),
		).toMatchObject({ excludeFromAnalytics: false, entryKind: "STANDARD" });
		await expect(
			forUser(cris.user.id).apply(resolveHiddenMutation, {
				answers: [{ id: hidden, answer: "SPENDING" }],
			}),
		).rejects.toThrow();
	});

	it("the notice shows once", async () => {
		expect((await dismissMigrationNotice(cris.user.id)).noticeOpen).toBe(false);
		expect((await getMigrationState(cris.user.id)).noticeOpen).toBe(false);
	});
});

describe("a currency with no rate", () => {
	it("is listed, nobody is migrated at 1, and a rate that arrives lets the next run through", async () => {
		const d = await person();
		const rent = await d.cat("Rent", true);
		const fun = await d.cat("Fun");
		await budget(d.user.id, { categoryId: rent, amount: "500.00" });
		await budget(d.user.id, {
			categoryId: fun,
			amount: "100.00",
			currency: "XTM",
		});
		const first = await apply(d.user.id);
		expect(first.reports[0]).toMatchObject({
			status: "MISSING_RATE",
			missingRates: ["XTM"],
			envelopes: 0,
		});
		expect(
			await adminDb.budgetBook.count({ where: { createdById: d.user.id } }),
		).toBe(0);
		// The lazy read leaves them on "Just track" without an error.
		expect(await getMonth(d.user.id, undefined, new Date(), "UTC")).toBeNull();
		await rate("XTM", "official", 2);
		try {
			const second = await apply(d.user.id);
			// 100.00 XTM at 2 per USD is 50.00 USD.
			expect(second.reports[0]).toMatchObject({
				status: "MIGRATED",
				fundedMinor: 55_000,
				missingRates: [],
			});
		} finally {
			await adminDb.exchangeRate.deleteMany({ where: { currency: "XTM" } });
		}
	});
});

describe("the first read moves a person in, once, even when reads race", () => {
	it("three reads at once make one book", async () => {
		const p = await person();
		const rent = await p.cat("Rent", true);
		await budget(p.user.id, { categoryId: rent, amount: "800.00" });
		const months = await Promise.all([
			getMonth(p.user.id, undefined, new Date(), "UTC"),
			getMonth(p.user.id, undefined, new Date(), "UTC"),
			getMonth(p.user.id, undefined, new Date(), "UTC"),
		]);
		expect(
			await adminDb.budgetBook.count({ where: { createdById: p.user.id } }),
		).toBe(1);
		for (const m of months) {
			expect(row(m, "Rent")?.assigned.minor).toBe(80_000);
			expect(m?.book.style).toBe("LIMITS");
		}
		const book = await bookOf(p.user.id);
		expect(book.timeZoneConfirmed).toBe(true);
		expect(book.legacyMigrationRunId).toMatch(/^lazy-/);
	});

	it("Needs you and the dashboard pace move them in too", async () => {
		const n = await person();
		const rent = await n.cat("Rent", true);
		await budget(n.user.id, { categoryId: rent, amount: "250.00" });
		await userTransaction(adminDb, n.user.id, (tx) =>
			needsYouIn(tx, n.user.id, { budget: true, timeZone: "UTC" }),
		);
		expect(
			await adminDb.budgetBook.count({ where: { createdById: n.user.id } }),
		).toBe(1);
		const p = await person();
		const dine = await p.cat("Dining");
		await budget(p.user.id, { categoryId: dine, amount: "75.00" });
		const pace = await getPacing(p.user.id, new Date(), "UTC");
		expect(pace?.total.budget).toEqual({ minor: 7_500, currency: "USD" });
	});

	it("a person with no old budgets stays on Just track", async () => {
		const p = await person();
		expect(await getMonth(p.user.id, undefined, new Date(), "UTC")).toBeNull();
		expect(
			await adminDb.budgetBook.count({ where: { createdById: p.user.id } }),
		).toBe(0);
	});
});

describe("rolling a run back", () => {
	it("deletes the books of the run, leaves the old rows, and refuses a book with money moved since unless forced", async () => {
		const [a, b] = [await person(), await person()];
		for (const p of [a, b]) {
			const rent = await p.cat("Rent", true);
			await budget(p.user.id, { categoryId: rent, amount: "300.00" });
		}
		const runId = `test-${randomUUID()}`;
		await migrateUsers(adminDb, {
			apply: true,
			userIds: [a.user.id, b.user.id],
			runId,
		});
		const book = await bookOf(b.user.id);
		await adminDb.budgetMovement.create({
			data: {
				id: randomUUID(),
				bookId: book.id,
				month: current,
				toEnvelopeId: book.defaultEnvelopeId,
				amount: D(10),
				kind: "ASSIGN",
				actorUserId: b.user.id,
			},
		});
		const soft = await rollbackRun(adminDb, runId, false);
		expect(soft.removed).toEqual([a.user.id]);
		expect(soft.refused).toEqual([{ userId: b.user.id, movements: 1 }]);
		const forced = await rollbackRun(adminDb, runId, true);
		expect(forced.removed).toEqual([b.user.id]);
		expect(
			await adminDb.budgetBook.count({
				where: { legacyMigrationRunId: runId },
			}),
		).toBe(0);
		expect(await adminDb.budget.count({ where: { userId: a.user.id } })).toBe(
			1,
		);
		// And they can be moved again.
		const again = await apply(a.user.id);
		expect(again.reports[0]?.status).toBe("MIGRATED");
	});
});

describe("the expense index", () => {
	it("exists on expense.budgetEnvelopeId", async () => {
		const rows = await adminDb.$queryRaw<{ indexname: string }[]>`
			SELECT indexname FROM pg_indexes
			 WHERE tablename = 'expense' AND indexname = 'expense_budgetEnvelopeId_idx'`;
		expect(rows).toHaveLength(1);
	});
});
