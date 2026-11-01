/**
 * The Currencies dialog's server reads on a real Postgres: the rate history
 * against the home currency (stored days plus the newest rates, read as the
 * app role), and what you spent in one original currency. Rates are global
 * and pg files share a database: LAK and KHR are stored by no other test.
 * Expected values are worked out by hand from the rows below.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { readCurrencySpending } from "~/server/services/currency-spending.service";
import { readRateHistory } from "~/server/services/rate-history.service";
import { adminDb, createTestUser } from "~/test/pg-harness";

const day = (d: string) => new Date(`${d}T00:00:00Z`);
const NOW = new Date("2026-10-04T12:00:00Z");

let me: Awaited<ReturnType<typeof createTestUser>>;
let other: Awaited<ReturnType<typeof createTestUser>>;

beforeAll(async () => {
	me = await createTestUser();
	other = await createTestUser();
	await adminDb.user.updateMany({
		where: { id: { in: [me.user.id, other.user.id] } },
		data: { homeCurrency: "LAK" },
	});
	await adminDb.exchangeRateHistory.createMany({
		data: [
			{
				date: day("2026-10-01"),
				currency: "LAK",
				type: "official",
				rate: "85",
			},
			{
				date: day("2026-10-02"),
				currency: "LAK",
				type: "official",
				rate: "86",
			},
			{
				date: day("2026-10-03"),
				currency: "LAK",
				type: "official",
				rate: "87",
			},
			{
				date: day("2026-10-01"),
				currency: "KHR",
				type: "official",
				rate: "10.5",
			},
		],
	});
	// The newest rates: today's KHR is not in the history yet.
	await adminDb.exchangeRate.createMany({
		data: [
			{
				date: day("2026-10-03"),
				currency: "LAK",
				type: "official",
				rate: "87",
			},
			{
				date: day("2026-10-03"),
				currency: "KHR",
				type: "official",
				rate: "10.9",
			},
		],
	});
	await adminDb.expense.createMany({
		data: [
			{
				userId: me.user.id,
				title: "Taxi",
				amount: "100",
				currency: "KHR",
				amountInUSD: "9.17",
				exchangeRate: "10.9",
				pricingSource: "MANUAL",
				date: day("2026-10-02"),
			},
			{
				userId: me.user.id,
				title: "Lunch",
				amount: "50",
				currency: "KHR",
				amountInUSD: "4.59",
				exchangeRate: "10.9",
				pricingSource: "MANUAL",
				date: day("2026-10-03"),
			},
			{
				userId: me.user.id,
				title: "Bread",
				amount: "200",
				currency: "LAK",
				amountInUSD: "2.30",
				exchangeRate: "87",
				pricingSource: "MANUAL",
				date: day("2026-10-03"),
			},
		],
	});
});

describe("readRateHistory", () => {
	it("prices every stored day, merging the newest rates, as the app role", async () => {
		const h = await readRateHistory(me.db, me.user.id, "KHR", "ALL", NOW);
		expect(h.home).toBe("LAK");
		// 85 / 10.5, 86 / 10.5 (KHR carries), 87 / 10.9: 1 KHR is LAK 8.10, 8.19, 7.98.
		expect(h.base).toBe("KHR");
		expect(h.defaultType).toBe("official");
		expect(h.series).toHaveLength(1);
		expect(h.series[0]?.points.map((p) => [p.date, p.price.minor])).toEqual([
			["2026-10-01", 810],
			["2026-10-02", 819],
			["2026-10-03", 798],
		]);
		expect(h.series[0]?.points[0]?.price.currency).toBe("LAK");
	});

	it("cuts to the range but keeps where the currency stands", async () => {
		const h = await readRateHistory(
			me.db,
			me.user.id,
			"KHR",
			"1M",
			new Date("2026-12-31T00:00:00Z"),
		);
		expect(h.series[0]?.points.map((p) => p.date)).toEqual(["2026-10-03"]);
	});

	it("is empty for a currency with no stored rate, never a 1", async () => {
		const h = await readRateHistory(me.db, me.user.id, "NPR", "ALL", NOW);
		expect(h.series).toEqual([]);
		expect(h.base).toBeNull();
	});
});

describe("readCurrencySpending", () => {
	it("totals one original currency, with the home value under the totals rule", async () => {
		const s = await readCurrencySpending(me.db, me.user.id, "KHR", NOW);
		expect(s.home).toBe("LAK");
		expect(s.count).toBe(2);
		expect(s.original).toEqual({ minor: 15000, currency: "KHR" });
		// 9.17 + 4.59 USD at 87 LAK per USD.
		expect(s.inHome).toEqual({ minor: 119712, currency: "LAK" });
	});

	it("counts the home currency as its own value", async () => {
		const s = await readCurrencySpending(me.db, me.user.id, "LAK", NOW);
		expect(s.count).toBe(1);
		expect(s.original).toEqual({ minor: 20000, currency: "LAK" });
		expect(s.inHome).toEqual({ minor: 20000, currency: "LAK" });
	});

	it("reads zero for a currency you never spent in, and nobody else's rows", async () => {
		const none = await readCurrencySpending(me.db, me.user.id, "NPR", NOW);
		expect(none.count).toBe(0);
		expect(none.original).toEqual({ minor: 0, currency: "NPR" });
		const theirs = await readCurrencySpending(
			other.db,
			other.user.id,
			"KHR",
			NOW,
		);
		expect(theirs.count).toBe(0);
	});
});
