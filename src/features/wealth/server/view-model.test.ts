import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { buildWealthView } = await import("./view-model");
type Input = Parameters<typeof buildWealthView>[0];

const updatedAt = new Date("2026-10-20T15:00:00Z");
const asset = (
	a: Partial<Input["dashboard"]["assets"][number]> &
		Pick<Input["dashboard"]["assets"][number], "id" | "type" | "currency">,
) => ({
	name: a.id,
	balance: 0,
	balanceInTargetCurrency: 0,
	exchangeRateType: null,
	isLiquid: false,
	interestRate: null,
	rateMissing: false,
	updatedAt,
	...a,
});

// Hand-built: ARS home, USD at 1,450 ARS. Assets 1,840,000 + 3,407,500
// (USD 2,350) + 4,200,000 = 9,447,500; the card owes 486,000; CLP has no rate.
const input: Input = {
	home: "ARS",
	today: "2026-10-22",
	averageMonthlySpend: 600000,
	ratesUpdated: "2026-10-22",
	hideAmounts: false,
	rateTypes: { ARS: ["blue", "official"], USD: [] },
	dashboard: {
		totalNetWorth: 8961500,
		totalLiquidAssets: 5247500,
		netWorth30DaysAgo: 8500000,
		history: [
			{ date: "2026-08-01", amount: 8000000 },
			{ date: "2026-09-01", amount: 8500000 },
			{ date: "2026-10-01", amount: 8700000 },
			{ date: "2026-10-22", amount: 8961500 },
		],
		assets: [
			asset({
				id: "galicia",
				type: "CASH",
				currency: "ARS",
				balance: 1840000,
				balanceInTargetCurrency: 1840000,
				exchangeRateType: "official",
				isLiquid: true,
			}),
			asset({
				id: "wise",
				type: "CASH",
				currency: "USD",
				balance: 2350,
				balanceInTargetCurrency: 3407500,
				isLiquid: true,
			}),
			asset({
				id: "fci",
				type: "INVESTMENT",
				currency: "ARS",
				balance: 4200000,
				balanceInTargetCurrency: 4200000,
			}),
			asset({
				id: "visa",
				type: "LIABILITY_CREDIT_CARD",
				currency: "ARS",
				balance: -486000,
				balanceInTargetCurrency: -486000,
				interestRate: 118,
			}),
			asset({
				id: "clp",
				type: "CASH",
				currency: "CLP",
				balance: 1000,
				rateMissing: true,
				isLiquid: true,
			}),
		],
		closedAssets: [
			{
				id: "old",
				name: "Old loan",
				type: "LIABILITY_LOAN",
				currency: "USD",
				balance: 100,
				closedAt: new Date("2026-10-10T12:00:00Z"),
			},
		],
	},
};

describe("buildWealthView", () => {
	const view = buildWealthView(input);
	const ars = (minor: number) => ({ minor, currency: "ARS" });

	it("converts the headline numbers once, to minor units", () => {
		expect(view.netWorth).toEqual(ars(896150000));
		expect(view.liquid).toEqual(ars(524750000));
		// 461,500 on 8,500,000 is 5.429%.
		expect(view.change30).toEqual({ amount: ars(46150000), basis: 543 });
	});

	it("groups accounts and leaves a missing rate out of the total", () => {
		expect(view.groups.map((g) => [g.key, g.total.minor])).toEqual([
			["cash", 524750000],
			["investments", 420000000],
			["liabilities", -48600000],
		]);
		const cash = view.groups[0]?.accounts ?? [];
		expect(cash.find((a) => a.id === "clp")?.home).toBeNull();
		expect(cash.find((a) => a.id === "wise")?.home).toEqual(ars(340750000));
		expect(cash.find((a) => a.id === "galicia")?.home).toBeUndefined();
		expect(view.missingRates).toBe(1);
	});

	it("reads a liability as negative whatever sign it was stored with", () => {
		const visa = view.groups[2]?.accounts[0];
		expect(visa?.amount).toEqual(ars(-48600000));
		expect(visa?.apr).toBe(118);
		expect(view.closed[0]).toMatchObject({
			amount: { minor: -10000, currency: "USD" },
			closedOn: "2026-10-10",
		});
	});

	it("shares in hundredths of a percent, largest first", () => {
		expect(view.allocation).toEqual([
			{ key: "cash", value: ars(524750000), share: 5554, series: 1 },
			{ key: "investments", value: ars(420000000), share: 4446, series: 2 },
		]);
		expect(view.breakdown.byCurrency.map((s) => [s.key, s.share])).toEqual([
			["ARS", 6393],
			["USD", 3607],
		]);
		expect(view.breakdown.byLiquidity.map((s) => [s.key, s.share])).toEqual([
			["liquid", 5554],
			["illiquid", 4446],
		]);
	});

	it("starts a range at the balance held on its first day", () => {
		expect(view.series["1M"].map((p) => [p.date, p.value.minor])).toEqual([
			["2026-09-22", 850000000],
			["2026-10-01", 870000000],
			["2026-10-22", 896150000],
		]);
		expect(view.series["3M"]).toHaveLength(4);
	});

	it("runway: liquid assets over the average month, one decimal", () => {
		expect(view.runway).toEqual({ months: 8.7, monthly: ars(60000000) });
	});

	it("only a foreign currency carries rate types", () => {
		const galicia = view.groups[0]?.accounts[0];
		expect(galicia?.rateType).toBeNull();
		expect(galicia?.rateTypes).toEqual([]);
	});

	it("no 30-day baseline: no change", () => {
		const v = buildWealthView({
			...input,
			dashboard: { ...input.dashboard, netWorth30DaysAgo: null },
		});
		expect(v.change30).toBeNull();
	});
});
