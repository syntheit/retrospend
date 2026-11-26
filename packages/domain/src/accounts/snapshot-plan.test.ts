import { describe, expect, it } from "vitest";
import { dec } from "../precise-decimal";
import { snapshotDay, snapshotPlan } from "./snapshot-plan";

describe("snapshotDay", () => {
	// Tokyo is UTC+9: 2026-03-10T16:00Z is already March 11 there.
	const tokyo = new Date("2026-03-10T16:00:00.000Z");

	it("the zone rule dates the instant by the person's day", () => {
		expect(
			snapshotDay({ rule: "zone", now: tokyo, timeZone: "Asia/Tokyo" }),
		).toEqual(new Date("2026-03-11T00:00:00.000Z"));
	});

	it("the UTC rule dates the same instant by the UTC day", () => {
		expect(snapshotDay({ rule: "utc", now: tokyo })).toEqual(
			new Date("2026-03-10T00:00:00.000Z"),
		);
	});

	it("Buenos Aires is a day behind UTC just after midnight UTC", () => {
		// 01:30Z on Dec 1 is 22:30 on Nov 30 at UTC-3.
		const now = new Date("2026-12-01T01:30:00.000Z");
		expect(
			snapshotDay({
				rule: "zone",
				now,
				timeZone: "America/Argentina/Buenos_Aires",
			}),
		).toEqual(new Date("2026-11-30T00:00:00.000Z"));
		expect(snapshotDay({ rule: "utc", now })).toEqual(
			new Date("2026-12-01T00:00:00.000Z"),
		);
	});

	it("does not move the instant it was given", () => {
		const now = new Date("2026-03-10T16:00:00.000Z");
		snapshotDay({ rule: "utc", now });
		expect(now.toISOString()).toBe("2026-03-10T16:00:00.000Z");
	});
});

describe("snapshotPlan", () => {
	const day = new Date("2026-11-26T00:00:00.000Z");
	const recordedAt = new Date("2026-11-26T12:00:00.000Z");
	const meta = {
		currency: "ARS",
		type: "CASH",
		exchangeRateType: "official",
	} as const;

	it("rounds the USD value to cents half to even (1,544,996.25 / 1,050 = 1,471.425)", () => {
		const plan = snapshotPlan({
			day,
			units: "1544996.25",
			usd: dec("1544996.25").div(1050),
			meta,
			recordedAt,
		});
		expect(plan.row.balanceInUSD).toBe("1471.42");
		expect(plan.row.balance).toBe("1544996.25");
	});

	it("the negative tie rounds toward the even cent too", () => {
		const plan = snapshotPlan({
			day,
			units: "-1544996.25",
			usd: dec("-1544996.25").div(1050),
			meta,
			recordedAt,
		});
		expect(plan.row.balanceInUSD).toBe("-1471.42");
	});

	it("keeps the account's currency, type and rate type on the row", () => {
		const plan = snapshotPlan({
			day,
			units: 0,
			usd: 0,
			meta: {
				currency: "USD",
				type: "INVESTMENT",
				exchangeRateType: undefined,
			},
			recordedAt,
		});
		expect(plan.row).toEqual({
			balance: "0",
			balanceInUSD: "0.00",
			currency: "USD",
			type: "INVESTMENT",
			exchangeRateType: null,
			recordedAt,
		});
	});

	it("the history row carries the same balance and the plan the day it upserts on", () => {
		const plan = snapshotPlan({
			day,
			units: "2.5",
			usd: "2.5",
			meta,
			recordedAt,
		});
		expect(plan.history).toEqual({ balance: "2.5" });
		expect(plan.day).toBe(day);
	});
});
