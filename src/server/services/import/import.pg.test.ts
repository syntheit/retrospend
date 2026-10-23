/**
 * The Import page's server on real Postgres: the review's counts, the
 * commit's kinds and booked home values, already in Activity, the preview
 * equal to the write, and Undo taking the whole batch back. ARS home; today's
 * rates ARS 1,468 Blue (the default), 1,412 Official, 1,449 MEP per USD.
 *
 * The file: 8 readable rows and 2 the reader could not read (no date).
 *   0 Coto            ARS 38,200   "Supermercado" (no such category)
 *   1 Amazon          USD 10       Blue: 1,468 -> ARS 14,680.00
 *   2 Sueldo          ARS 850,000  kind income
 *   3 Devolucion      ARS 5,000    kind refund
 *   4 A ahorro        ARS 100,000  kind not spending
 *   5 Misterio        XYZ 5        no rate anywhere
 *   6 Cafe            ARS 3,500    already in Activity
 *   7 Sin marcar      ARS 1,000    unchecked
 */
import { beforeAll, describe, expect, it } from "vitest";
import { forUser } from "~/server/services/preview";
import { adminDb } from "~/test/pg-harness";
import type { Prisma } from "~prisma";
import {
	arsUser,
	isoDay,
	seedArsRates,
	TODAY,
} from "../accounts/test-fixtures";
import { type CommitImportInput, commitImport } from "./commit.mutation";
import { importReview } from "./review";
import { undoImport } from "./undo.mutation";

beforeAll(seedArsRates);

const DAY = isoDay(TODAY);
const row = (
	title: string,
	amount: number,
	currency: string,
	extra: Record<string, unknown> = {},
) => ({
	title,
	amount,
	currency,
	date: DAY,
	location: "",
	description: "",
	pricingSource: "IMPORT",
	category: "",
	...extra,
});

const FILE = [
	row("Coto", 38200, "ARS", { category: "Supermercado" }),
	row("Amazon", 10, "USD"),
	row("Sueldo", 850000, "ARS", { kind: "income" }),
	row("Devolucion", 5000, "ARS", { kind: "refund" }),
	row("A ahorro", 100000, "ARS", { kind: "not spending" }),
	row("Misterio", 5, "XYZ"),
	row("Cafe", 3500, "ARS"),
	row("Sin marcar", 1000, "ARS"),
];
const WARNINGS = [
	"Row 9: Missing date, skipping",
	"Row 10: Missing date, skipping",
	"Excel file contains 2 sheets.",
];

async function setup() {
	const { user } = await arsUser();
	const userId = user.id;
	const groceries = await adminDb.category.create({
		data: { userId, name: "Groceries", color: "emerald" },
	});
	const salary = await adminDb.category.create({
		data: { userId, name: "Salary", color: "teal", kind: "INCOME" },
	});
	const base = {
		userId,
		currency: "ARS",
		exchangeRate: 1468,
		pricingSource: "MANUAL",
	};
	// History: Coto was filed under Groceries; Cafe is already in Activity.
	await adminDb.expense.createMany({
		data: [
			{
				...base,
				title: "Coto",
				amount: 1000,
				amountInUSD: 0.68,
				date: new Date(TODAY.getTime() - 40 * 86_400_000),
				categoryId: groceries.id,
			},
			{
				...base,
				title: "Cafe",
				amount: 3500,
				amountInUSD: 2.38,
				date: new Date(`${DAY}T15:00:00.000Z`),
			},
		],
	});
	const job = await adminDb.importJob.create({
		data: {
			userId,
			status: "READY_FOR_REVIEW",
			type: "CSV",
			fileName: "galicia-oct.csv",
			fileSize: 1000,
			fileType: "csv",
			transactions: FILE as unknown as Prisma.InputJsonValue,
			warnings: WARNINGS,
			totalTransactions: FILE.length,
		},
	});
	return { userId, jobId: job.id, groceries: groceries.id, salary: salary.id };
}

function choices(
	s: Awaited<ReturnType<typeof setup>>,
): CommitImportInput["rows"] {
	return [
		{ index: 0, keep: true, categoryId: s.groceries, kind: "expense" },
		{ index: 1, keep: true, categoryId: null, kind: "expense" },
		{ index: 2, keep: true, categoryId: s.salary, kind: "income" },
		{ index: 3, keep: true, categoryId: s.groceries, kind: "refund" },
		{ index: 4, keep: true, categoryId: null, kind: "notSpending" },
		{ index: 5, keep: true, categoryId: null, kind: "expense" },
		{ index: 6, keep: true, categoryId: null, kind: "expense" },
		{ index: 7, keep: false, categoryId: null, kind: "expense" },
	];
}

const importedCount = (userId: string) =>
	adminDb.expense.count({ where: { userId, pricingSource: "IMPORT" } });

describe("importReview", () => {
	it("counts add up and every row carries what the import will save", async () => {
		const s = await setup();
		const review = await importReview(adminDb, s.userId, s.jobId);

		expect(review.counts).toEqual({
			fileRows: 10,
			unreadable: 2,
			duplicates: 1,
			noRate: 1,
		});
		const by = (i: number) => review.rows.find((r) => r.index === i);
		expect(by(1)).toMatchObject({
			amount: { minor: 1000, currency: "USD" },
			home: { minor: 1_468_000, currency: "ARS" },
			rate: {
				unit: { minor: 100, currency: "USD" },
				value: { minor: 146_800, currency: "ARS" },
				type: "blue",
			},
			kind: "expense",
		});
		expect(by(0)).toMatchObject({
			home: { minor: 3_820_000, currency: "ARS" },
			rate: null,
			categoryId: null,
			fileCategory: "Supermercado",
		});
		expect(review.rows.map((r) => r.kind)).toEqual([
			"expense",
			"expense",
			"income",
			"refund",
			"notSpending",
			"expense",
			"expense",
			"expense",
		]);
		expect(by(5)).toMatchObject({ noRate: true, home: null });
		expect(by(6)).toMatchObject({ duplicate: true });
		expect(review.unmatched).toEqual([
			{ name: "Supermercado", rows: 1, suggestionId: s.groceries },
		]);
	});

	it("a currency for every row drops the file's rates and books from the table", async () => {
		const s = await setup();
		const review = await importReview(adminDb, s.userId, s.jobId, {
			currency: "usd",
		});
		expect(review.currency).toBe("USD");
		// Coto ARS 38,200 read as USD 38,200 at Blue: ARS 56,077,600.
		expect(review.rows[0]).toMatchObject({
			amount: { minor: 3_820_000, currency: "USD" },
			home: { minor: 5_607_760_000, currency: "ARS" },
		});
	});
});

describe("import.commit", () => {
	it("previews exactly what it writes, then writes it as kinds at booked rates", async () => {
		const s = await setup();
		const input = { jobId: s.jobId, rows: choices(s) };
		const preview = await forUser(s.userId).preview(commitImport, input);
		expect(await importedCount(s.userId)).toBe(0);

		const applied = await forUser(s.userId).apply(commitImport, input);
		expect(applied.value).toEqual(preview.value);
		expect(applied.changes).toEqual(preview.changes);
		expect(applied.value).toMatchObject({
			fileRows: 10,
			created: 5,
			duplicates: 1,
			unchecked: 1,
			unreadable: 2,
			noRate: 1,
			from: DAY,
			to: DAY,
		});
		const v = applied.value;
		expect(
			v.created + v.duplicates + v.unchecked + v.unreadable + v.noRate,
		).toBe(v.fileRows);
		expect(v.byKind).toEqual([
			{
				kind: "expense",
				count: 2,
				total: { minor: 5_288_000, currency: "ARS" },
				withoutRate: 0,
			},
			{
				kind: "income",
				count: 1,
				total: { minor: 85_000_000, currency: "ARS" },
				withoutRate: 0,
			},
			{
				kind: "refund",
				count: 1,
				total: { minor: 500_000, currency: "ARS" },
				withoutRate: 0,
			},
			{
				kind: "notSpending",
				count: 1,
				total: { minor: 10_000_000, currency: "ARS" },
				withoutRate: 0,
			},
		]);

		const rows = await adminDb.expense.findMany({
			where: { userId: s.userId, pricingSource: "IMPORT" },
			orderBy: { title: "asc" },
		});
		const get = (title: string) => rows.find((r) => r.title === title);
		expect(get("Amazon")).toMatchObject({
			rateType: "blue",
			homeCurrency: "ARS",
			direction: "OUT",
			entryKind: "STANDARD",
		});
		expect(get("Amazon")?.homeRate?.toString()).toBe("1468");
		expect(get("Amazon")?.homeAmount?.toString()).toBe("14680");
		expect(get("Sueldo")).toMatchObject({
			direction: "IN",
			inType: "INCOME",
			categoryId: s.salary,
		});
		expect(get("Devolucion")).toMatchObject({
			direction: "IN",
			inType: "REFUND",
		});
		expect(get("A ahorro")).toMatchObject({
			direction: "OUT",
			entryKind: "NOT_SPENDING",
			inType: null,
		});
		expect(get("Coto")?.categoryId).toBe(s.groceries);

		const job = await adminDb.importJob.findUniqueOrThrow({
			where: { id: s.jobId },
		});
		expect(job).toMatchObject({
			status: "COMPLETED",
			importedCount: 5,
			skippedDuplicates: 1,
		});
		// Spending this month, per currency (a diff never converts): Coto
		// less the refund in ARS, Amazon in USD.
		const spent = applied.changes.filter((c) => c.id === "spent");
		expect(spent.map((c) => c.delta)).toEqual([
			{ minor: 3_320_000, currency: "ARS" },
			{ minor: 1000, currency: "USD" },
		]);
	});

	it("will not import the same job twice, and the same file again finds every row", async () => {
		const s = await setup();
		const input = { jobId: s.jobId, rows: choices(s) };
		await forUser(s.userId).apply(commitImport, input);
		await expect(forUser(s.userId).apply(commitImport, input)).rejects.toThrow(
			"already imported",
		);

		const again = await adminDb.importJob.create({
			data: {
				userId: s.userId,
				status: "READY_FOR_REVIEW",
				type: "CSV",
				fileName: "galicia-oct.csv",
				fileSize: 1000,
				fileType: "csv",
				transactions: FILE as unknown as Prisma.InputJsonValue,
			},
		});
		const review = await importReview(adminDb, s.userId, again.id);
		// The five created plus the coffee that was there before.
		expect(review.counts.duplicates).toBe(6);
	});

	it("refuses a category that does not fit the row's kind", async () => {
		const s = await setup();
		const rows = choices(s).map((c) =>
			c.index === 2 ? { ...c, categoryId: s.groceries } : c,
		);
		await expect(
			forUser(s.userId).apply(commitImport, { jobId: s.jobId, rows }),
		).rejects.toThrow("does not fit");
		expect(await importedCount(s.userId)).toBe(0);
	});

	it("never touches another user's job", async () => {
		const s = await setup();
		const other = await setup();
		await expect(
			forUser(other.userId).apply(commitImport, {
				jobId: s.jobId,
				rows: [],
			}),
		).rejects.toThrow("not found");
	});
});

describe("import.undo", () => {
	it("deletes the whole batch and makes the file reviewable again", async () => {
		const s = await setup();
		const applied = await forUser(s.userId).apply(commitImport, {
			jobId: s.jobId,
			rows: choices(s),
		});
		const undone = await forUser(s.userId).apply(undoImport, {
			jobId: s.jobId,
		});

		expect(undone.value).toEqual({ jobId: s.jobId, removed: 5 });
		expect(await importedCount(s.userId)).toBe(0);
		const spentOf = (r: {
			changes: readonly {
				id: string;
				currency: string;
				delta: { minor: number };
			}[];
		}) =>
			r.changes
				.filter((c) => c.id === "spent")
				.map((c) => `${c.currency} ${c.delta.minor}`);
		expect(spentOf(undone)).toEqual(["ARS -3320000", "USD -1000"]);
		expect(spentOf(applied)).toEqual(["ARS 3320000", "USD 1000"]);
		const review = await importReview(adminDb, s.userId, s.jobId);
		expect(review.counts.duplicates).toBe(1);
		await expect(
			forUser(s.userId).apply(undoImport, { jobId: s.jobId }),
		).rejects.toThrow("no import to undo");
	});
});
