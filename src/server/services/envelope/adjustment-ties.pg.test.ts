/**
 * A budget money-in row (starting balance, Adjustment) stores its USD value
 * from the exact rate, cents half to even, and its rate at 6 decimals, both
 * as decimal text, so Postgres never rounds them again. Hand-derived:
 *
 * - ARS 36.70 at Blue 1,468 per USD (seedArsRates): 36.70 / 1468 = 0.025,
 *   2.5 cents, 2 is even, so 0.02 (Prisma's half up gave 0.03).
 * - BTC 0.01 at 64,545.9 USD per coin multiplies: 645.459, so 645.46. The
 *   old division gave 0.01 / 64545.9 = 0.00000015..., stored as 0.00.
 * - USD 10.05 is 10.05 at rate 1.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { userTransaction } from "~/server/db-tx";
import { adminDb, fixtureDb } from "~/test/pg-harness";
import {
	arsUser,
	isoDay,
	seedArsRates,
	TODAY,
} from "../accounts/test-fixtures";
import { writeEntryRow } from "./adjustment";

/** A day no other file prices BTC on, so its rate is this file's. */
const BTC_DAY = new Date("2001-01-02T00:00:00.000Z");

beforeAll(async () => {
	await seedArsRates();
	await adminDb.exchangeRate.upsert({
		where: {
			date_currency_type: { date: BTC_DAY, currency: "BTC", type: "crypto" },
		},
		create: { date: BTC_DAY, currency: "BTC", type: "crypto", rate: "64545.9" },
		update: { rate: "64545.9" },
	});
});

describe("a budget money-in row's USD value", () => {
	it("rounds half to even from the exact rate, crypto multiplying", async () => {
		const { user, db } = await arsUser();
		const write = (
			minor: number,
			currency: string,
			rateType: string,
			day: Date,
		) =>
			userTransaction(db, user.id, (tx) =>
				writeEntryRow(tx, user.id, {
					minor,
					currency,
					rateType,
					date: day,
					today: isoDay(day),
					direction: "IN",
					entryKind: "ADJUSTMENT",
				}),
			);
		const ars = await write(3670, "ARS", "blue", TODAY);
		const btc = await write(1_000_000, "BTC", "crypto", BTC_DAY);
		const usd = await write(1005, "USD", "official", TODAY);

		const stored = async (id: string) => {
			const e = await fixtureDb.expense.findUniqueOrThrow({ where: { id } });
			return {
				amount: e.amount.toFixed(),
				exchangeRate: e.exchangeRate.toFixed(),
				amountInUSD: e.amountInUSD.toFixed(2),
			};
		};
		expect(await stored(ars.id)).toEqual({
			amount: "36.7",
			exchangeRate: "1468",
			amountInUSD: "0.02",
		});
		expect(await stored(btc.id)).toEqual({
			amount: "0.01",
			exchangeRate: "64545.9",
			amountInUSD: "645.46",
		});
		expect(await stored(usd.id)).toEqual({
			amount: "10.05",
			exchangeRate: "1",
			amountInUSD: "10.05",
		});
	});
});
