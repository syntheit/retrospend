import { describe, expect, it } from "vitest";
import { MissingRateError } from "../money-dec";
import { checkpointDifference, checkpointPlan } from "./checkpoint-plan";
import type { RatePick } from "./valuation";

const day = new Date("2026-11-26T00:00:00.000Z");
const recordedAt = new Date("2026-11-26T12:00:00.000Z");

/** ARS: blue 1,545 and official 1,050 per USD. */
const RATES: Record<string, Record<string, number>> = {
	ARS: { blue: 1545, official: 1050 },
};
const pick: RatePick = (currency, date, preferred) => {
	const types = RATES[currency];
	if (!types) return null;
	const type = preferred && types[preferred] ? preferred : "blue";
	return { rate: types[type] ?? 0, type, date, onOrBefore: true };
};

const usdAccount = {
	type: "INVESTMENT",
	currency: "USD",
	balance: "1000.00000000",
	countedUnits: "300.00000000",
} as const;

describe("checkpointPlan", () => {
	it("USD 1,000 to 1,200 at blue is a +200 leg booked at 309,000 ARS", () => {
		const plan = checkpointPlan({
			account: usdAccount,
			balance: "1200",
			rate: { rate: "1", rateType: "blue" },
			day,
			homeCurrency: "ARS",
			pick,
			recordedAt,
		});
		expect(plan.leg).toEqual({
			currency: "USD",
			amount: "200",
			homeAmount: "309000",
			homeCurrency: "ARS",
			date: day,
			source: "BALANCE_UPDATE",
		});
		expect(plan.account).toEqual({
			balance: "1200",
			countedUnits: "300",
			exchangeRate: "1",
			exchangeRateType: "blue",
		});
		expect(plan.snapshot.row.balance).toBe("1200");
		expect(plan.snapshot.row.balanceInUSD).toBe("1200.00");
		expect(plan.snapshot.row.exchangeRateType).toBe("blue");
	});

	it("the same update valued at official books 210,000 ARS", () => {
		const plan = checkpointPlan({
			account: usdAccount,
			balance: "1200",
			rate: { rate: "1", rateType: "official" },
			day,
			homeCurrency: "ARS",
			pick,
			recordedAt,
		});
		expect(plan.leg?.homeAmount).toBe("210000");
	});

	it("an ARS balance at official snapshots 1,544,996.25 / 1,050 as 1,471.42 (half-even tie)", () => {
		const plan = checkpointPlan({
			account: {
				type: "CASH",
				currency: "ARS",
				balance: "0",
				countedUnits: "0",
			},
			balance: "1544996.25",
			rate: { rate: "1050", rateType: "official" },
			day,
			homeCurrency: "USD",
			pick,
			recordedAt,
		});
		expect(plan.snapshot.row.balanceInUSD).toBe("1471.42");
		// The leg's home value is exact to 8 places: no rounding to cents.
		expect(plan.leg?.homeAmount).toBe("1471.425");
		expect(plan.account.exchangeRate).toBe("1050");
	});

	it("a negative balance keeps its sign: -1,544,996.25 snapshots -1,471.42", () => {
		const plan = checkpointPlan({
			account: {
				type: "CASH",
				currency: "ARS",
				balance: "0",
				countedUnits: "0",
			},
			balance: "-1544996.25",
			rate: { rate: "1050", rateType: "official" },
			day,
			homeCurrency: "USD",
			pick,
			recordedAt,
		});
		expect(plan.snapshot.row.balanceInUSD).toBe("-1471.42");
		expect(plan.leg?.amount).toBe("-1544996.25");
		expect(plan.account.countedUnits).toBe("0");
	});

	it("a balance already right writes no leg and needs no rates", () => {
		const plan = checkpointPlan({
			account: usdAccount,
			balance: "1000",
			rate: { rate: "1", rateType: "blue" },
			day,
			homeCurrency: "ARS",
			pick: null,
			recordedAt,
		});
		expect(plan.leg).toBeNull();
		expect(plan.notLogged.isZero()).toBe(true);
		expect(plan.snapshot.row.balanceInUSD).toBe("1000.00");
	});

	it("a leg with no rates loaded is a missing rate, never 1", () => {
		expect(() =>
			checkpointPlan({
				account: usdAccount,
				balance: "1200",
				rate: { rate: "1", rateType: "blue" },
				day,
				homeCurrency: "ARS",
				pick: null,
				recordedAt,
			}),
		).toThrow(MissingRateError);
	});

	it("an unusable account rate throws MissingRateError", () => {
		const ars = {
			type: "CASH",
			currency: "ARS",
			balance: "0",
			countedUnits: "0",
		} as const;
		for (const rate of ["0", "-5", "NaN"]) {
			expect(() =>
				checkpointPlan({
					account: ars,
					balance: "100",
					rate: { rate, rateType: null },
					day,
					homeCurrency: "USD",
					pick,
					recordedAt,
				}),
			).toThrow(MissingRateError);
		}
	});

	it("no rate for the home currency books the leg without a home value", () => {
		const plan = checkpointPlan({
			account: usdAccount,
			balance: "1200",
			rate: { rate: "1", rateType: "blue" },
			day,
			homeCurrency: "BRL",
			pick,
			recordedAt,
		});
		expect(plan.leg?.amount).toBe("200");
		expect(plan.leg?.homeAmount).toBeNull();
		expect(plan.leg?.homeCurrency).toBeNull();
	});

	it("paying a card down is money to you: owed 5,000 to 3,000 is +2,000", () => {
		const plan = checkpointPlan({
			account: {
				type: "LIABILITY_CREDIT_CARD",
				currency: "ARS",
				balance: "5000",
				countedUnits: "0",
			},
			balance: "3000",
			rate: { rate: "1545", rateType: "blue" },
			day,
			homeCurrency: "ARS",
			pick,
			recordedAt,
		});
		expect(plan.leg?.amount).toBe("2000");
		expect(plan.account.balance).toBe("3000");
		expect(plan.account.countedUnits).toBe("0");
	});

	it("counted units are cut to the new balance (D4)", () => {
		const plan = checkpointPlan({
			account: usdAccount,
			balance: "100",
			rate: { rate: "1", rateType: "blue" },
			day,
			homeCurrency: "ARS",
			pick,
			recordedAt,
		});
		expect(plan.account.countedUnits).toBe("100");
	});

	it("reads the rate as the decimal it is, not a float", () => {
		const plan = checkpointPlan({
			account: {
				type: "CASH",
				currency: "ARS",
				balance: "0",
				countedUnits: "0",
			},
			balance: "1",
			rate: { rate: "1545.1234565", rateType: "custom" },
			day,
			homeCurrency: "USD",
			pick,
			recordedAt,
		});
		// A tie at 6 places goes to the even digit: 1545.123456|5 -> 1545.123456.
		expect(plan.account.exchangeRate).toBe("1545.123456");
	});
});

describe("checkpointDifference", () => {
	it("is what you have after minus before, by kind", () => {
		expect(
			checkpointDifference(
				{ type: "CASH", balance: "100" },
				"130.5",
			).toString(),
		).toBe("30.5");
		expect(
			checkpointDifference(
				{ type: "LIABILITY_LOAN", balance: "100" },
				"130.5",
			).toString(),
		).toBe("-30.5");
	});
});
