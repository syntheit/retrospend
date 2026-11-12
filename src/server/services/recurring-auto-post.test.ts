/**
 * The RECURRING_AUTO_POST switch and the sweep-only `auto` input. The sweep
 * itself is tested on Postgres (recurring-auto-post.pg.test.ts).
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
	NODE_ENV: "production",
	RECURRING_AUTO_POST: undefined as string | undefined,
}));
const db = vi.hoisted(() => ({
	$queryRaw: vi.fn(async () => []),
	systemStatus: { upsert: vi.fn(async () => ({})) },
}));
vi.mock("~/env", () => ({ env }));
vi.mock("~/server/db", () => ({ db }));
vi.mock("~/server/services/preview", () => ({ forUser: vi.fn() }));

const { autoPostEnabled, autoPostOffReason, startRecurringAutoPost } =
	await import("./recurring-auto-post");

describe("autoPostEnabled", () => {
	it("is on by default only in production", () => {
		expect(autoPostEnabled(undefined, "production")).toBe(true);
		expect(autoPostEnabled(undefined, "development")).toBe(false);
		expect(autoPostEnabled(undefined, "test")).toBe(false);
	});

	it("follows the setting when set", () => {
		expect(autoPostEnabled("false", "production")).toBe(false);
		expect(autoPostEnabled("true", "development")).toBe(true);
	});
});

describe("autoPostOffReason", () => {
	it("names the setting when it says false", () => {
		expect(autoPostOffReason("false", "production")).toBe("setting");
		expect(autoPostOffReason("false", "development")).toBe("setting");
	});

	it("names the environment when unset outside production", () => {
		expect(autoPostOffReason(undefined, "development")).toBe("environment");
		expect(autoPostOffReason(undefined, "test")).toBe("environment");
	});

	it("is null when on", () => {
		expect(autoPostOffReason(undefined, "production")).toBeNull();
		expect(autoPostOffReason("true", "development")).toBeNull();
	});
});

describe("startRecurringAutoPost", () => {
	const HOUR = 60 * 60 * 1000;
	beforeAll(() => vi.useFakeTimers());
	afterAll(() => vi.useRealTimers());

	it("arms no timer and reads nothing when switched off", async () => {
		env.RECURRING_AUTO_POST = "false";
		startRecurringAutoPost();
		await vi.advanceTimersByTimeAsync(HOUR);
		expect(vi.getTimerCount()).toBe(0);
		expect(db.$queryRaw).not.toHaveBeenCalled();
	});

	it("stays off under test even when switched on", async () => {
		env.NODE_ENV = "test";
		env.RECURRING_AUTO_POST = "true";
		startRecurringAutoPost();
		await vi.advanceTimersByTimeAsync(HOUR);
		expect(db.$queryRaw).not.toHaveBeenCalled();
	});

	it("sweeps at start and every 15 minutes when on", async () => {
		env.NODE_ENV = "production";
		env.RECURRING_AUTO_POST = "true";
		startRecurringAutoPost();
		await vi.advanceTimersByTimeAsync(0);
		expect(db.$queryRaw).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(HOUR);
		expect(db.$queryRaw).toHaveBeenCalledTimes(5);
		expect(db.systemStatus.upsert).toHaveBeenCalledTimes(5);
	});
});

describe("the auto input", () => {
	it("is in no transport's recurring schema, so only the sweep sets it", () => {
		for (const file of [
			"src/server/api/routers/recurring.ts",
			"src/server/api/routers/recurring-steps.ts",
			"src/server/services/api-v1/recurring.ts",
			"packages/api-contract/src/recurring/index.ts",
		])
			expect(readFileSync(file, "utf8"), file).not.toMatch(/\bauto\b(?!-)/);
	});
});
