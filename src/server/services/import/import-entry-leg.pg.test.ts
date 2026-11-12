/**
 * An imported row whose home currency has no rate keeps its entry leg alone
 * (book.ts), stored the way bookRate stores one: the leg at 6 decimals and
 * the USD value from the exact leg, both half to even, as decimal text (the
 * money write guard refuses a JS number). The home is MNT, which no pg file
 * stores a rate for, so no home leg is booked. Hand-derived:
 *
 * - Hotel, EUR 28.5 with the file's rate 100 EUR per USD: 0.285 USD, a tie,
 *   8 is even, so 0.28 (half up gave 0.29). The leg stays 100.
 * - Tren, EUR 100 with only the file's USD 113.80: USD 1.138 per EUR, so the
 *   leg is 1 / 1.138 = 0.8787346..., 0.878735 at 6 decimals, and the USD
 *   value 100 x 1.138 = 113.80.
 */
import { describe, expect, it } from "vitest";
import { forUser } from "~/server/services/preview";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import type { Prisma } from "~prisma";
import { isoDay, TODAY } from "../accounts/test-fixtures";
import { commitImport } from "./commit.mutation";

const row = (
	title: string,
	amount: number,
	extra: Record<string, unknown>,
) => ({
	title,
	amount,
	currency: "EUR",
	date: isoDay(TODAY),
	location: "",
	description: "",
	pricingSource: "IMPORT",
	category: "",
	...extra,
});

const FILE = [
	row("Hotel", 28.5, { exchangeRate: 100 }),
	row("Tren", 100, { amountInUSD: 113.8 }),
];

describe("an import row with an entry leg and no home leg", () => {
	it("stores the leg and its USD value half to even, with no home leg", async () => {
		const { user } = await createTestUser();
		await adminDb.user.update({
			where: { id: user.id },
			data: { homeCurrency: "MNT" },
		});
		const job = await fixtureDb.importJob.create({
			data: {
				userId: user.id,
				status: "READY_FOR_REVIEW",
				type: "CSV",
				fileName: "trip.csv",
				fileSize: 100,
				fileType: "csv",
				transactions: FILE as unknown as Prisma.InputJsonValue,
				warnings: [],
				totalTransactions: FILE.length,
			},
		});
		await forUser(user.id).apply(commitImport, {
			jobId: job.id,
			rows: FILE.map((_, index) => ({
				index,
				keep: true,
				categoryId: null,
				kind: "expense" as const,
			})),
		});

		const stored = await fixtureDb.expense.findMany({
			where: { userId: user.id },
			orderBy: { amount: "asc" },
		});
		expect(
			stored.map((e) => ({
				amount: e.amount.toString(),
				exchangeRate: e.exchangeRate.toString(),
				amountInUSD: e.amountInUSD.toString(),
				homeCurrency: e.homeCurrency,
				homeAmount: e.homeAmount,
			})),
		).toEqual([
			{
				amount: "28.5",
				exchangeRate: "100",
				amountInUSD: "0.28",
				homeCurrency: null,
				homeAmount: null,
			},
			{
				amount: "100",
				exchangeRate: "0.878735",
				amountInUSD: "113.8",
				homeCurrency: null,
				homeAmount: null,
			},
		]);
	});
});
