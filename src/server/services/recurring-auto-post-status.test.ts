/**
 * The admin page's recurring auto-post state, from the status row the sweep
 * writes, the switch and the clock.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("~/env", () => ({
	env: { NODE_ENV: "production", RECURRING_AUTO_POST: undefined },
}));
vi.mock("~/server/db", () => ({ db: {} }));
vi.mock("~/server/services/preview", () => ({ forUser: vi.fn() }));

const { AUTO_POST_STALE_MS, autoPostStatus, readAutoPostStatus } = await import(
	"./recurring-auto-post-status"
);

const NOW = new Date("2026-11-12T12:00:00.000Z");
const MIN = 60 * 1000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const row = (over: Record<string, unknown> = {}, ranAgo = 5 * MIN) => ({
	lastRun: ago(ranAgo),
	posted: 2,
	raced: 1,
	missingRate: 0,
	retry: 0,
	capped: 0,
	failed: 0,
	...over,
});

describe("autoPostStatus", () => {
	it("is healthy after a clean pass, and posted, raced and retry change nothing", () => {
		const status = autoPostStatus(row({ retry: 3, raced: 4 }), true, NOW);
		expect(status.state).toBe("healthy");
		expect(status.lastRun).toBe(ago(5 * MIN));
		expect(status.counts).toEqual({
			posted: 2,
			missingRate: 0,
			capped: 0,
			failed: 0,
		});
	});

	it("keeps 45 minutes healthy and turns stale one millisecond later", () => {
		expect(AUTO_POST_STALE_MS).toBe(45 * MIN);
		expect(autoPostStatus(row({}, 45 * MIN), true, NOW).state).toBe("healthy");
		expect(autoPostStatus(row({}, 45 * MIN + 1), true, NOW).state).toBe(
			"stale",
		);
	});

	it("is stale before it is failing, since old counts say nothing about now", () => {
		const old = row({ failed: 2 }, 120 * MIN);
		expect(autoPostStatus(old, true, NOW).state).toBe("stale");
	});

	it("is failing when a template failed", () => {
		expect(autoPostStatus(row({ failed: 1 }), true, NOW).state).toBe("failing");
	});

	it("is attention, not failing, when a template is still catching up after the cap", () => {
		expect(autoPostStatus(row({ capped: 1 }), true, NOW).state).toBe(
			"attention",
		);
	});

	it("is attention for capped and a missing rate together", () => {
		const both = row({ capped: 1, missingRate: 2 });
		expect(autoPostStatus(both, true, NOW).state).toBe("attention");
	});

	it("is failing for capped and a failure together", () => {
		const both = row({ capped: 1, failed: 1 });
		expect(autoPostStatus(both, true, NOW).state).toBe("failing");
	});

	it("is attention, not failing, for a missing rate alone", () => {
		expect(autoPostStatus(row({ missingRate: 2 }), true, NOW).state).toBe(
			"attention",
		);
	});

	it("is failing when a failure and a missing rate come together", () => {
		const both = row({ failed: 1, missingRate: 2 });
		expect(autoPostStatus(both, true, NOW).state).toBe("failing");
	});

	it("is off when the setting is off, whatever the row says", () => {
		expect(autoPostStatus(row({ failed: 5 }), false, NOW).state).toBe("off");
		expect(autoPostStatus(undefined, false, NOW).state).toBe("off");
	});

	it("is stale with no row while on, and with one that cannot be read", () => {
		const none = { state: "stale", lastRun: null, counts: null };
		expect(autoPostStatus(undefined, true, NOW)).toEqual(none);
		expect(autoPostStatus({ lastRun: "not a date" }, true, NOW)).toEqual(none);
		expect(autoPostStatus({ ...row(), failed: "1" }, true, NOW)).toEqual(none);
	});
});

describe("readAutoPostStatus", () => {
	it("reads the sweep's row by its key", async () => {
		const findUnique = vi.fn(async () => ({ value: row({ failed: 1 }) }));
		const status = await readAutoPostStatus(
			{ systemStatus: { findUnique } },
			NOW,
			true,
		);
		expect(findUnique).toHaveBeenCalledWith({
			where: { key: "recurring_auto_post" },
		});
		expect(status.state).toBe("failing");
	});

	it("is stale when the row does not exist yet", async () => {
		const status = await readAutoPostStatus(
			{ systemStatus: { findUnique: async () => null } },
			NOW,
			true,
		);
		expect(status.state).toBe("stale");
	});
});
