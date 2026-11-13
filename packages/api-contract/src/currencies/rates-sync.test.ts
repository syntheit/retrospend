import { describe, expect, it } from "vitest";
import {
	contract,
	dailyRatesSchema,
	historyRateSchema,
	RATE_DAYS_DEFAULT_LIMIT,
	RATE_DAYS_MAX_LIMIT,
	rateDaysQuerySchema,
} from "../index";

const range = (from: string, to: string, extra: object = {}) =>
	rateDaysQuerySchema.safeParse({ from, to, ...extra });

describe("rate sync contract", () => {
	it("declares both routes with the read scope", () => {
		const c = contract.currencies;
		for (const [route, path] of [
			[c.dailyRates, "/rates/daily"],
			[c.historyRates, "/rates/history"],
		] as const) {
			expect(route["~orpc"].route.method).toBe("GET");
			expect(route["~orpc"].route.path).toBe(path);
			expect(route["~orpc"].meta.scope).toBe("read");
		}
	});

	it("shapes a daily table and refuses a malformed row", () => {
		const row = {
			id: "r1",
			currency: "ARS",
			type: "blue",
			date: "2026-03-05T00:00:00.000Z",
			unitsPerUsd: "1545",
			updatedAt: "2026-03-05T09:05:00.000Z",
		};
		const ok = { asOf: row.updatedAt, rates: [row] };
		expect(dailyRatesSchema.parse(ok)).toEqual(ok);
		expect(dailyRatesSchema.parse({ asOf: null, rates: [] }).rates).toEqual([]);
		for (const bad of [
			{ ...row, unitsPerUsd: 1545 },
			{ ...row, unitsPerUsd: "1e3" },
			{ ...row, date: "2026-03-05" },
			{ ...row, currency: "ars" },
		])
			expect(
				dailyRatesSchema.safeParse({ asOf: null, rates: [bad] }).success,
			).toBe(false);
	});

	it("shapes a history row by day", () => {
		const row = {
			date: "2026-03-05",
			currency: "ARS",
			type: "blue",
			unitsPerUsd: "1545.5",
		};
		expect(historyRateSchema.parse(row)).toEqual(row);
		expect(
			historyRateSchema.safeParse({ ...row, date: "2026-03-05T00:00:00Z" })
				.success,
		).toBe(false);
	});

	it("takes a range of at most 366 days, both ends counted", () => {
		expect(range("2019-01-01", "2019-01-01").success).toBe(true);
		expect(range("2019-01-01", "2020-01-01").success).toBe(true);
		expect(range("2019-01-01", "2020-01-02").success).toBe(false);
		expect(range("2019-01-02", "2019-01-01").success).toBe(false);
		expect(rateDaysQuerySchema.safeParse({ from: "2019-01-01" }).success).toBe(
			false,
		);
	});

	it("pages 1000 by default, at most 2000", () => {
		expect(range("2019-01-01", "2019-01-31").data?.limit).toBe(
			RATE_DAYS_DEFAULT_LIMIT,
		);
		expect(RATE_DAYS_DEFAULT_LIMIT).toBe(1000);
		expect(
			range("2019-01-01", "2019-01-31", { limit: "2000" }).data?.limit,
		).toBe(RATE_DAYS_MAX_LIMIT);
		expect(range("2019-01-01", "2019-01-31", { limit: "2001" }).success).toBe(
			false,
		);
		expect(range("2019-01-01", "2019-01-31", { limit: "0" }).success).toBe(
			false,
		);
	});
});
