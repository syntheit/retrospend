/**
 * pg-env.ts empties the tables every user shares before each file, so a rate
 * or setting written by an earlier file in the same worker never shows here.
 */
import { describe, expect, it } from "vitest";
import { adminDb } from "~/test/pg-harness";

describe("shared tables at the start of a file", () => {
	it("hold no rates, rate history or app settings", async () => {
		await expect(adminDb.exchangeRate.count()).resolves.toBe(0);
		await expect(adminDb.exchangeRateHistory.count()).resolves.toBe(0);
		await expect(adminDb.appSettings.count()).resolves.toBe(0);
	});
});
