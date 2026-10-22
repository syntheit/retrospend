import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createTestUser } from "~/test/pg-harness";
import { consumeRateLimit, pruneRateLimits } from "../rate-limit.service";

const WINDOW = 60_000;
// 12:00:10 in a minute-aligned window that ends at 12:01:00.
const T0 = new Date("2026-10-22T12:00:10.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

describe("consumeRateLimit on Postgres", () => {
	it("allows `limit` requests per window, then answers with the wait", async () => {
		const key = `test:${randomUUID()}`;
		const counts: boolean[] = [];
		for (let i = 0; i < 4; i++) {
			counts.push((await consumeRateLimit(key, 3, WINDOW, T0)).allowed);
		}
		expect(counts).toEqual([true, true, true, false]);

		const denied = await consumeRateLimit(key, 3, WINDOW, at(20_000));
		expect(denied).toMatchObject({ allowed: false, count: 5, limit: 3 });
		// 12:00:30 -> window ends 12:01:00: 30 seconds.
		expect(denied.retryAfterSeconds).toBe(30);
	});

	it("starts over in the next window", async () => {
		const key = `test:${randomUUID()}`;
		for (let i = 0; i < 3; i++) await consumeRateLimit(key, 3, WINDOW, T0);
		const next = await consumeRateLimit(key, 3, WINDOW, at(WINDOW));
		expect(next).toMatchObject({ allowed: true, count: 1 });
	});

	it("never resets a newer window when a request carries an older clock", async () => {
		const key = `test:${randomUUID()}`;
		await consumeRateLimit(key, 2, WINDOW, at(WINDOW));
		const skewed = await consumeRateLimit(key, 2, WINDOW, T0);
		expect(skewed.count).toBe(2);
		expect((await consumeRateLimit(key, 2, WINDOW, at(WINDOW))).allowed).toBe(
			false,
		);
	});

	it("counts concurrent requests exactly", async () => {
		const key = `test:${randomUUID()}`;
		const results = await Promise.all(
			Array.from({ length: 10 }, () => consumeRateLimit(key, 5, WINDOW, T0)),
		);
		expect(results.filter((r) => r.allowed)).toHaveLength(5);
		expect(results.map((r) => r.count).sort((a, b) => a - b)).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
		]);
	});

	it("prunes old windows", async () => {
		const key = `test:${randomUUID()}`;
		await consumeRateLimit(key, 1, WINDOW, new Date("2000-01-01T00:00:00Z"));
		expect(
			await pruneRateLimits(new Date("2000-01-02T00:00:00Z")),
		).toBeGreaterThan(0);
	});

	it("is unreachable for the app role", async () => {
		const { db } = await createTestUser();
		await expect(db.apiRateLimit.findMany()).rejects.toThrow(
			/permission denied/,
		);
	});
});
