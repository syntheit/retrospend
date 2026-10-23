/**
 * The import duplicate rule (queue-import-dupes.md) on real Postgres, case
 * by case: exact matches are skipped, likely ones (same amount within 3 days,
 * another description) stay and are flagged, matching is 1:1 against
 * Activity and never within the file, kinds never cross, and a previous
 * import is recognized after its title was edited. ARS home.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { forUser } from "~/server/services/preview";
import { adminDb } from "~/test/pg-harness";
import type { Prisma } from "~prisma";
import {
	arsUser,
	daysAgo,
	isoDay,
	seedArsRates,
} from "../accounts/test-fixtures";
import { commitImport } from "./commit.mutation";
import { importReview } from "./review";

beforeAll(seedArsRates);

const D0 = isoDay(daysAgo(5));
const D1 = isoDay(daysAgo(4));
const D_1 = isoDay(daysAgo(6));

type FileRow = { title: string; amount: number; day: string; kind?: string };

const fileRow = (r: FileRow) => ({
	title: r.title,
	amount: r.amount,
	currency: "ARS",
	date: r.day,
	location: "",
	description: "",
	pricingSource: "IMPORT",
	category: "",
	...(r.kind ? { kind: r.kind } : {}),
});

async function job(userId: string, rows: FileRow[]) {
	const created = await adminDb.importJob.create({
		data: {
			userId,
			status: "READY_FOR_REVIEW",
			type: "CSV",
			fileName: "statement.csv",
			fileSize: 1,
			fileType: "csv",
			transactions: rows.map(fileRow) as unknown as Prisma.InputJsonValue,
		},
	});
	return created.id;
}

/** An Activity row typed by hand (midday, so its day is the same in any zone). */
async function typed(
	userId: string,
	title: string,
	amount: number,
	day: string,
	refund = false,
) {
	await adminDb.expense.create({
		data: {
			userId,
			title,
			amount,
			currency: "ARS",
			date: new Date(`${day}T15:00:00.000Z`),
			exchangeRate: 1468,
			amountInUSD: 1,
			pricingSource: "MANUAL",
			...(refund
				? { direction: "IN" as const, inType: "REFUND" as const }
				: {}),
		},
	});
}

const keepAll = (n: number) =>
	Array.from({ length: n }, (_, index) => ({
		index,
		keep: true,
		categoryId: null,
		kind: "expense" as const,
	}));

async function user() {
	return (await arsUser()).user.id;
}

describe("import duplicates", () => {
	it("case 1: the same statement again is already in Activity, row for row", async () => {
		const u = await user();
		const rows = [
			{ title: "COTO SUPERMERCADO", amount: 38200, day: D0 },
			{ title: "FARMACITY", amount: 15400, day: D1 },
		];
		await forUser(u).apply(commitImport, {
			jobId: await job(u, rows),
			rows: keepAll(2),
		});
		const again = await importReview(adminDb, u, await job(u, rows));
		expect(again.rows.map((r) => r.duplicate)).toEqual([true, true]);
		expect(again.counts.duplicates).toBe(2);
	});

	it("case 2: a hand-typed expense days earlier is flagged, kept; the same description is exact", async () => {
		const u = await user();
		await typed(u, "Coffee", 2500, D0);
		await typed(u, "Café Martínez", 7800, D0);
		const jobId = await job(u, [
			{ title: "MERPAGO*CAFE MARTINEZ", amount: 2500, day: D1 },
			{ title: "CAFE MARTINEZ", amount: 7800, day: D0 },
		]);
		const review = await importReview(adminDb, u, jobId);
		expect(review.rows[0]).toMatchObject({
			duplicate: false,
			possible: { title: "Coffee", date: D0 },
		});
		expect(review.rows[1]).toMatchObject({ duplicate: true, possible: null });

		const applied = await forUser(u).apply(commitImport, {
			jobId,
			rows: keepAll(2),
		});
		// The likely one counts as imported unless skipped; the exact one is skipped.
		expect(applied.value).toMatchObject({ created: 1, duplicates: 1 });
	});

	it("case 3: a real second fare the day before is only flagged, never skipped", async () => {
		const u = await user();
		await typed(u, "SUBE", 1000, D_1);
		const jobId = await job(u, [{ title: "SUBE", amount: 1000, day: D0 }]);
		const review = await importReview(adminDb, u, jobId);
		expect(review.rows[0]).toMatchObject({
			duplicate: false,
			possible: { title: "SUBE", date: D_1 },
		});
		const applied = await forUser(u).apply(commitImport, {
			jobId,
			rows: keepAll(1),
		});
		expect(applied.value.created).toBe(1);
	});

	it("case 6: a refund never matches a purchase of the same amount", async () => {
		const u = await user();
		await typed(u, "Zapatillas", 52000, D0, true);
		const review = await importReview(
			adminDb,
			u,
			await job(u, [{ title: "Zapatillas", amount: 52000, day: D0 }]),
		);
		expect(review.rows[0]).toMatchObject({ duplicate: false, possible: null });
	});

	it("case 7: two identical charges in one file both import", async () => {
		const u = await user();
		const jobId = await job(u, [
			{ title: "UBER TRIP", amount: 8400, day: D0 },
			{ title: "UBER TRIP", amount: 8400, day: D0 },
		]);
		const review = await importReview(adminDb, u, jobId);
		expect(review.rows.map((r) => [r.duplicate, r.possible])).toEqual([
			[false, null],
			[false, null],
		]);
		const applied = await forUser(u).apply(commitImport, {
			jobId,
			rows: keepAll(2),
		});
		expect(applied.value.created).toBe(2);
	});

	it("case 8: one Activity row matches one file row; the other imports", async () => {
		const u = await user();
		await typed(u, "SUBE", 1000, D0);
		const jobId = await job(u, [
			{ title: "SUBE", amount: 1000, day: D0 },
			{ title: "SUBE", amount: 1000, day: D0 },
		]);
		const review = await importReview(adminDb, u, jobId);
		expect(review.rows.map((r) => [r.duplicate, r.possible])).toEqual([
			[true, null],
			[false, null],
		]);
		const applied = await forUser(u).apply(commitImport, {
			jobId,
			rows: keepAll(2),
		});
		expect(applied.value).toMatchObject({ created: 1, duplicates: 1 });
	});

	it("case 9: an imported row edited since is still recognized", async () => {
		const u = await user();
		const rows = [{ title: "LA ESQUINA PARRILLA", amount: 45300, day: D0 }];
		await forUser(u).apply(commitImport, {
			jobId: await job(u, rows),
			rows: keepAll(1),
		});
		await adminDb.expense.updateMany({
			where: { userId: u, title: "LA ESQUINA PARRILLA" },
			data: { title: "Cena con Lucía", date: new Date(`${D1}T15:00:00.000Z`) },
		});
		const again = await importReview(adminDb, u, await job(u, rows));
		expect(again.rows[0]).toMatchObject({ duplicate: true });
	});
});
