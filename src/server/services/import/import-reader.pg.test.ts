/**
 * Import through the real CSV reader (ImportQueueService.processQueue), a
 * double commit racing, and a 5,000-row statement in one commit. Rates as in
 * the account fixtures: ARS 1,468 Blue, 1,412 Official, 1,449 MEP per USD.
 */

import { beforeAll, describe, expect, it } from "vitest";
import { ImportQueueService } from "~/server/services/import-queue.service";
import { forUser } from "~/server/services/preview";
import { adminDb, createTestUser } from "~/test/pg-harness";
import type { Prisma } from "~prisma";
import { isoDay, seedArsRates, TODAY } from "../accounts/test-fixtures";
import { commitImport } from "./commit.mutation";
import { importReview } from "./review";
import { importRunner } from "./runner";

beforeAll(seedArsRates);

const DAY = isoDay(TODAY);

/** A USD-home user whose default rate type is Official (not Blue, the table's first). */
async function officialUser() {
	const { user } = await createTestUser();
	await adminDb.user.update({
		where: { id: user.id },
		data: { homeCurrency: "USD", defaultRateTypes: { USD: "official" } },
	});
	return user.id;
}

/** Reads `csv` the way the queue does, start to READY_FOR_REVIEW. */
async function readCsv(userId: string, csv: string) {
	const job = await adminDb.importJob.create({
		data: {
			userId,
			status: "QUEUED",
			type: "CSV",
			fileName: "galicia.csv",
			fileSize: csv.length,
			fileType: "csv",
			fileData: Buffer.from(csv).toString("base64"),
		},
	});
	await new ImportQueueService(adminDb).processQueue(userId);
	const read = await adminDb.importJob.findUniqueOrThrow({
		where: { id: job.id },
	});
	expect(read.status).toBe("READY_FOR_REVIEW");
	return job.id;
}

const choicesFor = (n: number) =>
	Array.from({ length: n }, (_, index) => ({
		index,
		keep: true,
		categoryId: null,
		kind: "expense" as const,
	}));

describe("import through the CSV reader", () => {
	it("books a looked-up rate at the user's default type, and a row with no rate is no rate", async () => {
		const userId = await officialUser();
		const jobId = await readCsv(
			userId,
			[
				"date,title,amount,currency",
				`${DAY},Cafe,14120,ARS`,
				`${DAY},Misterio,5,XYZ`,
				",Sin fecha,100,ARS",
			].join("\n"),
		);
		const review = await importReview(adminDb, userId, jobId);
		// ARS 14,120 at Official 1,412 = USD 10.00 (Blue would give 9.62).
		expect(review.rows[0]).toMatchObject({
			amount: { minor: 1_412_000, currency: "ARS" },
			home: { minor: 1000, currency: "USD" },
			rate: { type: "official" },
		});
		expect(review.counts).toEqual({
			fileRows: 3,
			unreadable: 1,
			duplicates: 0,
			noRate: 1,
		});

		const applied = await forUser(userId).apply(commitImport, {
			jobId,
			rows: choicesFor(1),
		});
		expect(applied.value).toMatchObject({
			fileRows: 3,
			created: 1,
			unreadable: 1,
			noRate: 1,
		});
		const row = await adminDb.expense.findFirstOrThrow({
			where: { userId, title: "Cafe" },
		});
		expect(row.rateType).toBe("official");
		expect(row.exchangeRate.toString()).toBe("1412");
		expect(row.homeAmount?.toString()).toBe("10");
	});
});

describe("import.commit races", () => {
	it("two commits of one file write it once", async () => {
		const userId = await officialUser();
		const jobId = await readCsv(
			userId,
			[
				"date,title,amount,currency",
				`${DAY},Uno,1000,ARS`,
				`${DAY},Dos,2000,ARS`,
			].join("\n"),
		);
		const input = { jobId, rows: choicesFor(2) };
		const results = await Promise.allSettled([
			forUser(userId).apply(commitImport, input),
			forUser(userId).apply(commitImport, input),
		]);
		expect(results.map((r) => r.status).sort()).toEqual([
			"fulfilled",
			"rejected",
		]);
		const failed = results.find((r) => r.status === "rejected");
		expect(String((failed as PromiseRejectedResult).reason)).toContain(
			"already imported",
		);
		expect(
			await adminDb.expense.count({
				where: { userId, pricingSource: "IMPORT" },
			}),
		).toBe(2);
	});
});

describe("a 5,000-row statement", () => {
	it("commits in one transaction within the import timeout", async () => {
		const { user } = await createTestUser();
		await adminDb.user.update({
			where: { id: user.id },
			data: { homeCurrency: "ARS" },
		});
		const rows = Array.from({ length: 5000 }, (_, i) => ({
			title: `Row ${i}`,
			amount: 1000 + i,
			currency: i % 3 === 0 ? "USD" : "ARS",
			date: isoDay(new Date(TODAY.getTime() - (i % 20) * 86_400_000)),
			location: "",
			description: "",
			pricingSource: "IMPORT",
			category: "",
		}));
		const job = await adminDb.importJob.create({
			data: {
				userId: user.id,
				status: "READY_FOR_REVIEW",
				type: "CSV",
				fileName: "big.csv",
				fileSize: 1,
				fileType: "csv",
				transactions: rows as unknown as Prisma.InputJsonValue,
			},
		});
		const started = Date.now();
		const applied = await importRunner(user.id).apply(commitImport, {
			jobId: job.id,
			rows: choicesFor(5000),
		});
		const ms = Date.now() - started;
		process.stderr.write(`5,000-row commit: ${ms} ms\n`);
		expect(applied.value.created).toBe(5000);
	}, 120_000);
});
