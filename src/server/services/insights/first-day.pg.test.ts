/**
 * Where All time starts, on a real Postgres. Ana lives in Buenos Aires
 * (UTC-3). Her oldest spending is a refund-free expense at 2026-08-31
 * 23:30 local (Sep 1 02:30Z): it is August 31 for her. Income earlier than
 * that and an expense later do not move it.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { adminDb } from "~/test/pg-harness";
import {
	insightsUser,
	row,
	seedDkkRates,
	sharedExpense,
} from "./__tests__/fixture";
import { insightsFirstDay } from "./index";

const NOW = new Date("2026-10-24T15:00:00Z");

let ana: string;
let nobody: string;

beforeAll(async () => {
	await seedDkkRates();
	ana = await insightsUser();
	nobody = await insightsUser();
	await row(ana, {
		at: "2026-08-01T12:00:00-03:00",
		amount: "500",
		usd: "70",
		kind: "income",
	});
	await row(ana, { at: "2026-08-31T23:30:00-03:00", amount: "70", usd: "10" });
	await row(ana, { at: "2026-10-03T12:00:00-03:00", amount: "100", usd: "15" });
});

describe("insights first day", () => {
	it("is the day of the oldest spending in her calendar; income does not count", async () => {
		expect(await insightsFirstDay(adminDb, ana, { now: NOW })).toEqual({
			day: "2026-08-31",
		});
	});

	it("a share older than her own rows moves it back", async () => {
		const other = await insightsUser();
		await sharedExpense({
			payer: other,
			userId: ana,
			share: "40",
			at: "2026-07-15T12:00:00-03:00",
		});
		expect(await insightsFirstDay(adminDb, ana, { now: NOW })).toEqual({
			day: "2026-07-15",
		});
	});

	it("no spending is no day", async () => {
		expect(await insightsFirstDay(adminDb, nobody, { now: NOW })).toEqual({
			day: null,
		});
	});
});
