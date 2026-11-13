/**
 * The six-decimal tie in the rate band, on a stub database (the Postgres
 * file, rate-band.pg.test.ts, covers the band itself). BTC is stored in USD
 * per coin, so one BTC stored at 1.000002 USD gives the band 0.2000004 to
 * 5.00001 for a typed rate into USD. Pinned before and after the retype to
 * the domain Decimal (money-decimal PR 6a).
 */
import { describe, expect, it, vi } from "vitest";
import { type PlannedSettlement, quote } from "./allocate";
import { assertTypedRate, RateOutOfRangeError } from "./rate-band";

const db = {
	exchangeRate: {
		findMany: vi.fn(
			async (args: { where: { date: { lte?: Date; gt?: Date } } }) =>
				args.where.date.lte ? [{ type: "market", rate: "1.000002" }] : [],
		),
	},
} as never;

const planned = (rate: string, isOffset: boolean): PlannedSettlement => ({
	scope: null,
	currency: "BTC",
	amount: 100,
	from: isOffset ? "payee" : "payer",
	isOffset,
	paid: 0,
	quote: quote(rate, "custom"),
});

const check = (rate: string, isOffset: boolean) =>
	assertTypedRate(db, {
		into: "USD",
		custom: { rate, currency: "BTC" },
		date: new Date("2026-06-15T00:00:00.000Z"),
		planned: [planned(rate, isOffset)],
	});

describe("an offset row keeps the typed rate at six decimals, half to even", () => {
	it("0.2000005 is inside the band as typed, but a tie that rounds to the even 0.200000, below 0.2000004", async () => {
		await expect(check("0.2000005", false)).resolves.toBeUndefined();
		await expect(check("0.2000005", true)).rejects.toBeInstanceOf(
			RateOutOfRangeError,
		);
	});

	it("0.2000015 is a tie that rounds up to 0.200002, inside the band", async () => {
		await expect(check("0.2000015", true)).resolves.toBeUndefined();
	});
});
