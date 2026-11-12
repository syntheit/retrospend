// New values are decimal text: the rate at 6 decimals, USD to cents, both
// half to even and derived by hand in each comment.
import { describe, expect, it } from "vitest";
import { DEFAULT_RATES } from "~/test/rate-table";
import { findInconsistentExpenses, type RepairExpense } from "../money-repair";

const D = new Date("2026-07-20T12:00:00Z");

function exp(
	id: string,
	currency: string,
	amount: number,
	exchangeRate: number,
	amountInUSD: number,
	extra: Partial<RepairExpense> = {},
): RepairExpense {
	return {
		id,
		userId: "ars-user",
		date: D,
		currency,
		amount,
		exchangeRate,
		amountInUSD,
		pricingSource: "official",
		...extra,
	};
}

const HOMES: Record<string, string> = {
	"ars-user": "ARS",
	"usd-user": "USD",
	"brl-user": "BRL",
};

function run(expenses: RepairExpense[]) {
	return findInconsistentExpenses({
		expenses,
		homeCurrencyOf: (id) => HOMES[id] ?? "USD",
		rates: DEFAULT_RATES,
	}).findings;
}

describe("findInconsistentExpenses", () => {
	it("leaves healthy expenses alone, including older ARS rates", () => {
		expect(
			run([
				exp("ok-usd", "USD", 10, 1, 10),
				exp("ok-ars", "ARS", 100000, 1560, 64.1, { pricingSource: "blue" }),
				exp("old-ars", "ARS", 100000, 1100, 90.91, {
					date: new Date("2025-06-01"),
				}),
				exp("ok-eur", "EUR", 100, 0.8787, 113.8),
				exp("ok-btc", "BTC", 0.01, 64545.9, 645.46),
			]),
		).toEqual([]);
	});

	it("bug 1: 100 EUR stored with an ARS-home cross rate becomes about $113.80", () => {
		// The table's 0.8787: 100 / 0.8787 = 113.8044..., so 113.80.
		const [f] = run([exp("eur", "EUR", 100, 1775.35, 0.06)]);
		expect(f).toMatchObject({
			reason: "cross-rate",
			newRate: "0.8787",
			newUSD: "113.80",
		});
	});

	it("bug 1: BRL-home cross rate (only 6.6x off) is still caught", () => {
		const [f] = run([
			exp("eur-brl", "EUR", 100, 5.8243, 17.17, { userId: "brl-user" }),
		]);
		expect(f).toMatchObject({ reason: "cross-rate", newUSD: "113.80" });
	});

	it("bug 1: crypto stored with home-per-coin is about 1500x too large", () => {
		const [f] = run([
			exp("btc", "BTC", 0.01, 64545.9 * 1560, 1006916.04, {
				pricingSource: "crypto",
			}),
		]);
		// 0.01 x 64545.9 = 645.459, so 645.46.
		expect(f).toMatchObject({ newRate: "64545.9", newUSD: "645.46" });
	});

	it("bug 2: 100,000 ARS at rate 1 is repaired using nearby healthy ARS rates", () => {
		const findings = run([
			exp("bad", "ARS", 100000, 1, 100000),
			exp("n1", "ARS", 1000, 1500, 0.67),
			exp("n2", "ARS", 1000, 1510, 0.66),
			exp("n3", "ARS", 1000, 1520, 0.66),
		]);
		expect(findings).toHaveLength(1);
		// The median 1510: 100000 / 1510 = 66.225..., so 66.23.
		expect(findings[0]).toMatchObject({
			reason: "rate-one",
			newRate: "1510",
			newUSD: "66.23",
		});
	});

	it("bug 4: crypto imported in the wrong direction keeps the rate, fixes USD", () => {
		const [f] = run([exp("imp", "BTC", 0.5, 60000, 0.00000833, { userId: "usd-user" })]);
		// 0.5 x 60000 = 30000.
		expect(f).toMatchObject({
			reason: "usd-mismatch",
			newRate: "60000",
			newUSD: "30000.00",
		});
	});

	it("bug 4: an inverted crypto rate with a good USD amount derives the rate", () => {
		const [f] = run([exp("inv", "ETH", 2, 2 / 3800, 3800, { userId: "usd-user" })]);
		// One division, crypto USD / amount: 3800 / 2 = 1900 exactly.
		expect(f).toMatchObject({
			reason: "implausible",
			newRate: "1900",
			newUSD: "3800.00",
		});
	});

	it("old sidecar: ARS 'crypto' type multiplied instead of divided", () => {
		const [f] = run([
			exp("side", "ARS", 10000, 1594.68, 15946800, { pricingSource: "RECURRING" }),
		]);
		// 10000 / 1594.68 = 6.2708..., so 6.27.
		expect(f).toMatchObject({
			reason: "usd-mismatch",
			newRate: "1594.68",
			newUSD: "6.27",
		});
	});

	it("USD expenses must be rate 1 with amountInUSD = amount", () => {
		const findings = run([
			exp("u1", "USD", 50, 1560, 50),
			exp("u2", "USD", 50, 1, 0.03),
		]);
		expect(findings.map((f) => [f.reason, f.newRate, f.newUSD])).toEqual([
			["usd-rate", "1", "50.00"],
			["usd-amount", "1", "50.00"],
		]);
	});

	it("an implausible fiat rate with a good USD amount divides once: 100000 / 64.10", () => {
		// Stored at 15.6 against the table's 1560 (100x off), USD 64.10 is
		// plausible: the rate is 100000 / 64.1 = 1560.0624024960..., so
		// 1560.062402 at 6 decimals (next digit 4); USD stays 64.10.
		const [f] = run([exp("inv-ars", "ARS", 100000, 15.6, 64.1)]);
		expect(f).toMatchObject({
			reason: "implausible",
			newRate: "1560.062402",
			newUSD: "64.10",
		});
	});

	it("a recomputed USD value ties half to even: ARS 427.5 at 1500 is 0.28", () => {
		// 427.5 / 1500 = 0.285: 28.5 cents, 8 is even (half up gave 0.29).
		const [f] = run([exp("tie", "ARS", 427.5, 1500, 5)]);
		expect(f).toMatchObject({
			reason: "usd-mismatch",
			newRate: "1500",
			newUSD: "0.28",
		});
	});

	it("a tie stored half up is not flagged: ARS 427.5 at 1500 saved as 0.29", () => {
		// 0.285 exact, 0.28 half to even; 0.29 is within the 0.02 tolerance.
		expect(run([exp("old", "ARS", 427.5, 1500, 0.29)])).toEqual([]);
	});

	it("USD from the exact median, not its 6-decimal copy (D4)", () => {
		// Healthy BTC rates 64545.000001 to ...004: the median of an even count
		// is (64545.000002 + 64545.000003) / 2 = 64545.0000025, stored as
		// 64545.000002 (a tie, 2 even). 30000 BTC x 64545.0000025 =
		// 1,936,350,000.075, a tie at cents: 7 is odd, so .08. The rounded rate
		// would give 30000 x 64545.000002 = 1,936,350,000.06.
		const healthy = ["64545.000001", "64545.000002", "64545.000003", "64545.000004"].map(
			(rate, i) => exp(`n${i}`, "BTC", 0.01, Number(rate), 645.45, { userId: "usd-user" }),
		);
		const findings = run([
			exp("bad", "BTC", 30000, 1, 30000, { userId: "usd-user" }),
			...healthy,
		]);
		expect(findings).toHaveLength(1);
		expect(findings[0]).toMatchObject({
			reason: "rate-one",
			newRate: "64545.000002",
			newUSD: "1936350000.08",
		});
	});

	it("skips currencies without any table rate instead of guessing", () => {
		const result = findInconsistentExpenses({
			expenses: [exp("x", "XAU", 1, 1, 1)],
			homeCurrencyOf: () => "USD",
			rates: DEFAULT_RATES,
		});
		expect(result.findings).toEqual([]);
		expect(result.noTableRate.get("XAU")).toBe(1);
	});
});
