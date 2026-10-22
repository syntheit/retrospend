import { describe, expect, it } from "vitest";
import {
	allocationPercent,
	computeWealthStats,
	netWorthChange,
	netWorthPercentChange,
} from "../wealth-stats";

const cash = {
	type: "CASH",
	balanceInTargetCurrency: 600,
	balanceInUSD: 600,
	isLiquid: true,
};
const house = {
	type: "REAL_ESTATE",
	balanceInTargetCurrency: 400,
	balanceInUSD: 400,
	isLiquid: false,
};
const loan = {
	type: "LIABILITY_LOAN",
	balanceInTargetCurrency: 200,
	balanceInUSD: 200,
	isLiquid: false,
	interestRate: 10,
};

describe("computeWealthStats", () => {
	it("totals assets, liabilities and net worth", () => {
		const stats = computeWealthStats([cash, house, loan], 700);
		expect(stats).toMatchObject({
			assets: 1000,
			liabilities: 200,
			netWorth: 800,
			totalLiquidAssets: 600,
			weightedAPR: 10,
			netWorth30DaysAgo: 700,
		});
	});
});

describe("allocationPercent", () => {
	it("is a share of total assets, not of a filtered subset", () => {
		const total = computeWealthStats([cash, house, loan]).assets;
		expect(allocationPercent(house, total)).toBe(40);
		expect(allocationPercent(cash, total)).toBe(60);
	});

	it("is null for a liability", () => {
		expect(allocationPercent(loan, 1000)).toBeNull();
	});
});

describe("netWorthChange", () => {
	it("is null without a baseline, never the whole net worth", () => {
		expect(netWorthChange(800, null)).toBeNull();
		expect(netWorthChange(800, undefined)).toBeNull();
		expect(computeWealthStats([cash]).netWorth30DaysAgo).toBeNull();
	});

	it("is the difference when a baseline exists, 0 included", () => {
		expect(netWorthChange(800, 700)).toBe(100);
		expect(netWorthChange(800, 0)).toBe(800);
	});
});

describe("netWorthPercentChange", () => {
	it("is null with no earlier value, never 100%", () => {
		expect(netWorthPercentChange(800, 0)).toBeNull();
		expect(netWorthPercentChange(800, undefined)).toBeNull();
		expect(netWorthPercentChange(800, null)).toBeNull();
	});

	it("measures change against the earlier value's size", () => {
		expect(netWorthPercentChange(110, 100)).toBeCloseTo(10);
		expect(netWorthPercentChange(-50, -100)).toBeCloseTo(50);
	});
});
