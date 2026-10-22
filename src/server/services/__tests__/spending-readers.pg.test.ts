/**
 * Characterization of every spending reader on one ledger (spending-fixture.ts),
 * written before the money-in work so "stats unchanged for users without money
 * in" is proven, not assumed (IMPLEMENTATION 2A.1). The expected numbers are
 * in spending-expected.ts, derived by hand from the fixture table.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("~/server/better-auth", () => ({
	auth: { api: { getSession: vi.fn() } },
}));

import {
	EXPECTED_LISTED,
	EXPECTED_READINGS,
	EXPECTED_RECENT,
	TREND_STEPS,
} from "./spending-expected";
import { NOW, seedSpendingFixture } from "./spending-fixture";
import { readAllSpendingReaders } from "./spending-readers";

type Readings = Awaited<ReturnType<typeof readAllSpendingReaders>>;

describe("spending readers today (characterization)", () => {
	let readings: Readings;

	beforeAll(async () => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(NOW);
		readings = await readAllSpendingReaders(await seedSpendingFixture());
	});
	afterAll(() => vi.useRealTimers());

	for (const [reader, expected] of Object.entries(EXPECTED_READINGS)) {
		it(`pins ${reader}`, () => {
			expect(readings[reader as keyof Readings]).toEqual(expected);
		});
	}

	it("pins the lists", () => {
		expect(readings.listed).toEqual(EXPECTED_LISTED);
		expect(readings.recent).toEqual(EXPECTED_RECENT);
	});

	it("pins the daily trend", () => {
		expect(readings.trend).toHaveLength(31);
		for (const [day, [total, fixed, variable]] of Object.entries(TREND_STEPS)) {
			expect(readings.trend.find((d) => d[0] === day)).toEqual([
				day,
				total,
				fixed,
				variable,
			]);
		}
	});
});
