/**
 * The stored rate history is read for the range only: a 1M read returns no
 * day older than the range, apart from the newest earlier day it falls back
 * to. KHR is stored by no other pg test (rates are global).
 */
import { describe, expect, it, vi } from "vitest";
import { adminDb, createTestUser } from "~/server/api/v1/core/__tests__/harness";
import { readRateHistory } from "../rate-history.service";

vi.mock("next/headers", () => ({
	headers: async () => new Headers(),
	cookies: async () => ({ get: () => undefined }),
}));

const day = (d: string) => new Date(`${d}T00:00:00Z`);

describe("readRateHistory range", () => {
	it("does not return days older than a 1M range", async () => {
		const { user } = await createTestUser();
		await adminDb.user.update({
			where: { id: user.id },
			data: { homeCurrency: "USD" },
		});
		await adminDb.exchangeRateHistory.createMany({
			skipDuplicates: true,
			data: [
				["2026-01-01", "50"],
				["2026-03-01", "55"],
				["2026-10-01", "60"],
				["2026-10-20", "65"],
			].map(([d, rate]) => ({
				date: day(d as string),
				currency: "KHR",
				type: "official",
				rate: rate as string,
			})),
		});
		const now = day("2026-10-25");
		const month = await readRateHistory(adminDb, user.id, "KHR", "1M", now);
		const dates = month.series.flatMap((s) => s.points.map((p) => p.date));
		expect(dates.length).toBeGreaterThan(0);
		expect(dates.every((d) => d >= "2026-09-25")).toBe(true);

		const all = await readRateHistory(adminDb, user.id, "KHR", "ALL", now);
		const allDates = all.series.flatMap((s) => s.points.map((p) => p.date));
		expect(allDates).toContain("2026-01-01");
	});
});
