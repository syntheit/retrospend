import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { buildRateHistory, rangeStart } = await import("./history");

const row = (currency: string, type: string, day: string, rate: string) => ({
	currency,
	type,
	day,
	rate,
});

// Units per USD (a coin: USD per coin), one row per stored day.
const ROWS = [
	row("ARS", "blue", "2026-10-01", "1400"),
	row("ARS", "blue", "2026-10-02", "1450"),
	row("ARS", "blue", "2026-10-03", "1500"),
	row("ARS", "official", "2026-10-01", "1300"),
	row("ARS", "official", "2026-10-03", "1350"),
	row("EUR", "official", "2026-10-01", "0.8"),
	row("EUR", "official", "2026-10-02", "0.9"),
	row("BTC", "crypto", "2026-10-01", "60000"),
];

const minors = (h: ReturnType<typeof buildRateHistory>, type: string) =>
	h.series.find((s) => s.type === type)?.points.map((p) => p.price.minor);

describe("buildRateHistory", () => {
	it("prices the stronger currency in the weaker per type, carrying rates over days not stored", () => {
		const h = buildRateHistory({
			code: "EUR",
			home: "ARS",
			rows: ROWS,
			range: "ALL",
			today: "2026-10-31",
		});
		expect(h.base).toBe("EUR");
		expect(h.defaultType).toBe("blue");
		expect(h.series.map((s) => s.type)).toEqual(["official", "blue"]);
		// Official: 1300 / 0.8, then ARS stays 1300 for EUR 0.9, then 1350 / 0.9.
		expect(minors(h, "official")).toEqual([162500, 144444, 150000]);
		// Blue is ARS blue over EUR official: 1400 / 0.8, 1450 / 0.9, 1500 / 0.9.
		expect(minors(h, "blue")).toEqual([175000, 161111, 166667]);
		expect(h.series.find((s) => s.type === "blue")?.derived).toBe(true);
		expect(h.series.find((s) => s.type === "official")?.derived).toBe(false);
		// Blue went 1750.00 to 1666.67: -4.76 percent.
		expect(h.series.find((s) => s.type === "blue")?.changeBp).toBe(-476);
	});

	it("keeps one number of places across every point and type", () => {
		const h = buildRateHistory({
			code: "ARS",
			home: "EUR",
			rows: [
				row("EUR", "official", "2026-10-01", "0.8"),
				row("ARS", "official", "2026-10-01", "1300"),
				row("ARS", "official", "2026-10-02", "1500"),
			],
			range: "ALL",
			today: "2026-10-31",
		});
		// ARS is the weaker one here: 1 EUR costs ARS, the unit is EUR.
		expect(h.base).toBe("EUR");
		const places = new Set(
			h.series.flatMap((s) => s.points.map((p) => p.price.places)),
		);
		expect(places.size).toBe(1);
	});

	it("prices a coin at its market price over the home default type", () => {
		const h = buildRateHistory({
			code: "BTC",
			home: "ARS",
			rows: ROWS,
			range: "ALL",
			today: "2026-10-31",
		});
		expect(h.series.map((s) => s.type)).toEqual(["market"]);
		// 60,000 USD at ARS blue 1400, 1450 and 1500 (the coin carries over).
		expect(minors(h, "market")).toEqual([8400000000, 8700000000, 9000000000]);
	});

	it("gives no history when either side has no rate, never a 1", () => {
		const none = buildRateHistory({
			code: "JPY",
			home: "ARS",
			rows: ROWS,
			range: "ALL",
			today: "2026-10-31",
		});
		expect(none.series).toEqual([]);
		expect(none.base).toBeNull();
		const noHome = buildRateHistory({
			code: "EUR",
			home: "CLP",
			rows: ROWS,
			range: "ALL",
			today: "2026-10-31",
		});
		expect(noHome.series).toEqual([]);
	});

	it("uses USD as 1 on either side", () => {
		const h = buildRateHistory({
			code: "USD",
			home: "ARS",
			rows: ROWS,
			range: "ALL",
			today: "2026-10-31",
		});
		expect(minors(h, "blue")).toEqual([140000, 145000, 150000]);
		const toUsd = buildRateHistory({
			code: "EUR",
			home: "USD",
			rows: ROWS,
			range: "ALL",
			today: "2026-10-31",
		});
		// 1 EUR is USD 1.25 and then 1.11 (1 / 0.8, 1 / 0.9): the euro is the unit.
		expect(toUsd.base).toBe("EUR");
		expect(minors(toUsd, "official")).toEqual([125, 111]);
	});

	it("cuts to the range but always keeps the newest day", () => {
		const month = buildRateHistory({
			code: "EUR",
			home: "ARS",
			rows: ROWS,
			range: "1M",
			today: "2026-10-31",
		});
		expect(minors(month, "official")).toEqual([162500, 144444, 150000]);
		const stale = buildRateHistory({
			code: "EUR",
			home: "ARS",
			rows: ROWS,
			range: "1M",
			today: "2026-12-31",
		});
		expect(stale.series.every((s) => s.points.length === 1)).toBe(true);
		expect(stale.series[0]?.changeBp).toBeNull();
	});
});

describe("rangeStart", () => {
	it("counts calendar days back and leaves ALL open", () => {
		expect(rangeStart("1M", "2026-10-31")).toBe("2026-10-01");
		expect(rangeStart("3M", "2026-10-31")).toBe("2026-08-01");
		expect(rangeStart("1Y", "2026-10-31")).toBe("2025-10-31");
		expect(rangeStart("ALL", "2026-10-31")).toBeNull();
	});
});
