/**
 * Ties in imported rows, on real Postgres, ARS home at Blue 1,468 per USD
 * (seedArsRates). Every stored figure is decimal text rounded half to even
 * before the write, so Postgres (half away from zero) never rounds it again.
 * Hand-derived:
 *
 * The Import page (commitImport, both legs):
 * - Mate, ARS 7 for the file's USD 0.015: USD per ARS is exactly 0.015 / 7,
 *   so the USD value is 0.015, a tie: 1 is odd, so 0.02. The leg 7 / 0.015
 *   = 466.666... is 466.666667. ARS is the home: 7.00 at rate 1.
 * - Hotel, EUR 28.5 at the file's 100 per USD: 0.285 USD, 8 even, so 0.28
 *   (half up gave 0.29). Home 28.5 x 1468 / 100 = 418.38, rate 14.68.
 * - Bolsillo, EUR 0.375 at 100: home 0.375 x 14.68 = 5.505, a tie: 0 is
 *   even, so 5.50 (half up gave 5.51). USD 0.00375, 0.00.
 * - Coin, BTC 0.0000005 for the file's USD 0.025: 0.025 / 0.0000005 = 50,000
 *   USD per coin; USD 0.025 is 2.5 cents, 2 even, so 0.02 (half up 0.03).
 *   Home 0.025 x 1468 = 36.70, rate 36.7 / 0.0000005 = 73,400,000.
 * - Dinar, KWD 0.3075 at 0.3 per USD: 1.025 USD, 2 even, so 1.02. Home
 *   0.3075 x 1468 / 0.3 = 1,504.70, rate 1468 / 0.3 = 4,893.333...,
 *   4893.333333333333 at 12 decimals.
 *
 * The CSV import (importExpensesFromRows, entry leg only): the same Mate,
 * Hotel, Coin and Dinar figures; USD 1.005 is 100.5 cents, so 1.00; ARS
 * 10.000000005 is a tie at the amount's 8 decimals: 0 is even, so 10 (half
 * away from zero gave 10.00000001), and 10 / 1000 = 0.01 USD.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { forUser } from "~/server/services/preview";
import { fixtureDb } from "~/test/pg-harness";
import type { Prisma } from "~prisma";
import {
	arsUser,
	isoDay,
	seedArsRates,
	TODAY,
} from "../accounts/test-fixtures";
import { CsvService } from "../csv.service";
import { commitImport } from "./commit.mutation";

beforeAll(seedArsRates);

const row = (
	title: string,
	amount: number,
	currency: string,
	extra: { exchangeRate?: number; amountInUSD?: number } = {},
) => ({
	title,
	amount,
	currency,
	date: isoDay(TODAY),
	location: "",
	description: "",
	pricingSource: "IMPORT",
	category: "",
	...extra,
});

async function storedOf(userId: string) {
	const rows = await fixtureDb.expense.findMany({ where: { userId } });
	return Object.fromEntries(
		rows.map((e) => [
			e.title,
			{
				amount: e.amount.toFixed(),
				exchangeRate: e.exchangeRate.toFixed(),
				amountInUSD: e.amountInUSD.toFixed(2),
				homeRate: e.homeRate?.toFixed() ?? null,
				homeAmount: e.homeAmount?.toFixed(2) ?? null,
			},
		]),
	);
}

describe("import ties round half to even", () => {
	it("the Import page books both legs from the exact rate", async () => {
		const { user } = await arsUser();
		const file = [
			row("Mate", 7, "ARS", { amountInUSD: 0.015 }),
			row("Hotel", 28.5, "EUR", { exchangeRate: 100 }),
			row("Bolsillo", 0.375, "EUR", { exchangeRate: 100 }),
			row("Coin", 0.0000005, "BTC", { amountInUSD: 0.025 }),
			row("Dinar", 0.3075, "KWD", { exchangeRate: 0.3 }),
		];
		const job = await fixtureDb.importJob.create({
			data: {
				userId: user.id,
				status: "READY_FOR_REVIEW",
				type: "CSV",
				fileName: "ties.csv",
				fileSize: 100,
				fileType: "csv",
				transactions: file as unknown as Prisma.InputJsonValue,
				warnings: [],
				totalTransactions: file.length,
			},
		});
		await forUser(user.id).apply(commitImport, {
			jobId: job.id,
			rows: file.map((_, index) => ({
				index,
				keep: true,
				categoryId: null,
				kind: "expense" as const,
			})),
		});

		expect(await storedOf(user.id)).toEqual({
			Mate: {
				amount: "7",
				exchangeRate: "466.666667",
				amountInUSD: "0.02",
				homeRate: "1",
				homeAmount: "7.00",
			},
			Hotel: {
				amount: "28.5",
				exchangeRate: "100",
				amountInUSD: "0.28",
				homeRate: "14.68",
				homeAmount: "418.38",
			},
			Bolsillo: {
				amount: "0.375",
				exchangeRate: "100",
				amountInUSD: "0.00",
				homeRate: "14.68",
				homeAmount: "5.50",
			},
			Coin: {
				amount: "0.0000005",
				exchangeRate: "50000",
				amountInUSD: "0.02",
				homeRate: "73400000",
				homeAmount: "36.70",
			},
			Dinar: {
				amount: "0.3075",
				exchangeRate: "0.3",
				amountInUSD: "1.02",
				homeRate: "4893.333333333333",
				homeAmount: "1504.70",
			},
		});
	});

	it("the CSV import stores the entry leg as decimal text", async () => {
		const { user, db } = await arsUser();
		const date = new Date(`${isoDay(TODAY)}T15:00:00.000Z`);
		const rows = [
			{ title: "Mate", amount: 7, currency: "ARS", amountInUSD: 0.015 },
			{ title: "Hotel", amount: 28.5, currency: "EUR", exchangeRate: 100 },
			{ title: "Coin", amount: 0.0000005, currency: "BTC", amountInUSD: 0.025 },
			{ title: "Dinar", amount: 0.3075, currency: "KWD", exchangeRate: 0.3 },
			{ title: "Libro", amount: 1.005, currency: "USD" },
			{
				title: "Mucho",
				amount: 10.000000005,
				currency: "ARS",
				exchangeRate: 1000,
			},
		].map((r) => ({ ...r, date }));
		await new CsvService(db).importExpensesFromRows(user.id, rows, {
			timeZone: "UTC",
		});

		const entry = (
			amount: string,
			exchangeRate: string,
			amountInUSD: string,
		) => ({
			amount,
			exchangeRate,
			amountInUSD,
			homeRate: null,
			homeAmount: null,
		});
		expect(await storedOf(user.id)).toEqual({
			Mate: entry("7", "466.666667", "0.02"),
			Hotel: entry("28.5", "100", "0.28"),
			Coin: entry("0.0000005", "50000", "0.02"),
			Dinar: entry("0.3075", "0.3", "1.02"),
			Libro: entry("1.005", "1", "1.00"),
			Mucho: entry("10", "1000", "0.01"),
		});
	});
});
