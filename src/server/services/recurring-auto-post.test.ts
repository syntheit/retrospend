/**
 * The RECURRING_AUTO_POST switch and where the `auto` input may be set. The sweep
 * itself is tested on Postgres (recurring-auto-post.pg.test.ts).
 */
import { readFileSync } from "node:fs";
import {
	confirmRecurringSchema,
	createRecurringSchema,
	skipRecurringSchema,
	updateRecurringSchema,
} from "@retrospend/api-contract";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

const env = vi.hoisted(() => ({
	NODE_ENV: "production",
	DATABASE_URL: "postgresql://u:p@localhost:5432/d",
	RECURRING_AUTO_POST: undefined as string | undefined,
}));
const db = vi.hoisted(() => ({
	$queryRaw: vi.fn(async () => []),
	systemStatus: { upsert: vi.fn(async () => ({})) },
}));
const port = vi.hoisted(() => ({
	apply: vi.fn(),
	isProtectedNow: vi.fn(async (_userId: string) => false),
}));
vi.mock("~/env", () => ({ env }));
vi.mock("~/server/db", () => ({ db }));
vi.mock("~/server/services/preview", () => ({
	forUser: vi.fn(() => ({ apply: port.apply })),
}));
vi.mock("~/server/services/protection/now", () => ({
	isProtectedNow: port.isProtectedNow,
}));
vi.mock("~/server/services/keys/data-key.service", () => ({
	ensureUserKeyringWhenSealing: vi.fn(async () => undefined),
}));

const {
	autoPostEnabled,
	autoPostOffReason,
	startRecurringAutoPost,
	sweepRecurringAutoPost,
} = await import("./recurring-auto-post");

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
	// A transport may set it (v1's confirm, for the phone's poster) because it
	// only adds a refusal; the web's tRPC and every other v1 write keep it out.
	it("is in the web's tRPC routers nowhere", () => {
		for (const file of [
			"src/server/api/routers/recurring.ts",
			"src/server/api/routers/recurring-steps.ts",
		])
			expect(readFileSync(file, "utf8"), file).not.toMatch(/\bauto\b(?!-)/);
	});

	it("is in v1's confirm schema and no other recurring schema", () => {
		expect(Object.keys(confirmRecurringSchema.shape)).toContain("auto");
		for (const schema of [
			skipRecurringSchema,
			createRecurringSchema,
			updateRecurringSchema,
		])
			expect(Object.keys(schema.shape)).not.toContain("auto");
	});
});

describe("the sweep's catch-up over the domain plan", () => {
	const DAY = 24 * 60 * 60 * 1000;
	const now = new Date("2026-03-10T12:00:00.000Z");
	const first = new Date(now.getTime() - 3 * DAY);

	beforeEach(() => {
		db.$queryRaw.mockResolvedValueOnce([
			{ id: "t1", userId: "u1", nextDueDate: first },
		] as never);
		port.apply.mockReset();
		port.isProtectedNow.mockReset().mockResolvedValue(false);
	});

	it("posts each due period at its own date and counts them", async () => {
		const dueDates: Date[] = [];
		port.apply.mockImplementation(async (_m, input) => {
			dueDates.push(input.dueDate);
			return { value: { nextDueAt: new Date(input.dueDate.getTime() + DAY) } };
		});
		const counts = await sweepRecurringAutoPost(now, db as never);
		expect(dueDates.map((d) => d.toISOString())).toEqual([
			"2026-03-07T12:00:00.000Z",
			"2026-03-08T12:00:00.000Z",
			"2026-03-09T12:00:00.000Z",
			"2026-03-10T12:00:00.000Z",
		]);
		expect(counts).toMatchObject({ posted: 4, capped: 0, failed: 0 });
	});

	it("stops a template whose protection read fails and logs it as a failure", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		port.isProtectedNow
			.mockResolvedValueOnce(false) // the sweep's own read before the key
			.mockRejectedValueOnce(new Error("db down at u1")); // before period 2
		port.apply.mockResolvedValue({
			value: { nextDueAt: new Date(first.getTime() + DAY) },
		});
		const counts = await sweepRecurringAutoPost(now, db as never);
		expect(port.apply).toHaveBeenCalledTimes(1);
		expect(counts).toMatchObject({ posted: 1, failed: 1 });
		expect(log).toHaveBeenCalledWith(
			"Recurring auto-post failed for one template:",
			"protection_unreadable",
		);
		log.mockRestore();
	});

	it("stops without a failure when protection turns on before period 2", async () => {
		port.isProtectedNow
			.mockResolvedValueOnce(false)
			.mockResolvedValueOnce(true);
		port.apply.mockResolvedValue({
			value: { nextDueAt: new Date(first.getTime() + DAY) },
		});
		const counts = await sweepRecurringAutoPost(now, db as never);
		expect(port.apply).toHaveBeenCalledTimes(1);
		expect(counts).toMatchObject({ posted: 1, failed: 0, capped: 0 });
	});
});
