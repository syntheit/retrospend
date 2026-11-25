/**
 * What a device's poster plans for a template, on the same vectors as the
 * server's sweep (recurring-sweep-characterization.pg.test.ts). The base case
 * is plan.test.ts's: home ARS, blue, saved zone Buenos Aires, a monthly USD 20
 * template due 2026-12-01T03:00Z. Hand-derived values:
 *   Catch-up due Sep 1, Oct 1, Nov 1 at blue 1,500, 1,520, 1,545:
 *     30,000.00, 30,400.00, 30,900.00
 *   Cap: a weekly template from 2026-01-07T03:00Z read at 2026-10-10T12:00Z
 *     has 40 periods due; a run plans 31 and the next is Aug 12.
 */
import { describe, expect, it } from "vitest";
import type { FakeStore } from "./fake-port";
import { type ConfirmPlan, planConfirm } from "./plan";
import {
	type PosterEntry,
	type PosterRunInput,
	PosterStampError,
	planPosterRun,
	posterEntry,
} from "./poster";
import { at, BA, ba, baseStore, ME, rate, TOKYO } from "./test-kit";

const NOW = at("2026-12-01T12:00:00.000Z");

function input(
	store: FakeStore,
	over: Partial<PosterRunInput> = {},
): PosterRunInput {
	return {
		userId: ME,
		template: store.template,
		autoPost: true,
		now: NOW,
		zone: store.zone,
		book: store.book,
		isProtected: async () => store.protectedAccount,
		...over,
	};
}

const SEPT = {
	template: { nextDueDate: ba("2026-09-01") },
	rates: [
		rate("2026-09-01", "ARS", "blue", 1500),
		rate("2026-10-01", "ARS", "blue", 1520),
		rate("2026-11-01", "ARS", "blue", 1545),
	],
};
const NOV = at("2026-11-01T12:00:00.000Z");

describe("planPosterRun", () => {
	it("plans each missed period at its own due date's rate, chained by stamp", async () => {
		const store = baseStore(SEPT);
		const run = await planPosterRun(input(store, { now: NOV }));
		expect(run.stopped).toBe("caught_up");
		expect(run.entries.map((e) => e.plan.entry.homeAmount)).toEqual([
			"30000.00",
			"30400.00",
			"30900.00",
		]);
		expect(run.entries.map((e) => e.dueAt.toISOString())).toEqual([
			"2026-09-01T03:00:00.000Z",
			"2026-10-01T03:00:00.000Z",
			"2026-11-01T03:00:00.000Z",
		]);
		// The first entry names the version pulled; each later one the entry before it.
		expect(run.entries.map((e) => e.expectedStamp)).toEqual([
			{ version: store.template.stamp },
			{ after: 0 },
			{ after: 1 },
		]);
		expect(run.entries.map((e) => e.index)).toEqual([0, 1, 2]);
		expect(run.entries.at(-1)?.plan.nextDueDate).toEqual(ba("2026-12-01"));
	});

	it("plans what the server's confirm would book, field for field", async () => {
		const store = baseStore();
		const run = await planPosterRun(input(store));
		const server: ConfirmPlan = await baseStore().confirm(NOW, {
			dueAt: ba("2026-12-01"),
			auto: true,
		});
		expect(run.entries).toHaveLength(1);
		expect(run.entries[0]?.plan).toEqual(server);
	});

	it("40 weekly periods: one run plans 31 and stops at the cap", async () => {
		const store = baseStore({
			template: {
				frequency: "WEEKLY",
				anchorDay: null,
				nextDueDate: ba("2026-01-07"),
			},
			rates: [rate("2026-01-01", "ARS", "blue", 1545)],
		});
		const run = await planPosterRun(
			input(store, { now: at("2026-10-10T12:00:00.000Z") }),
		);
		expect(run.stopped).toBe("cap");
		expect(run.entries).toHaveLength(31);
		expect(run.entries.at(-1)?.plan.nextDueDate).toEqual(
			at("2026-08-12T03:00:00.000Z"),
		);
	});

	describe("it plans nothing when the template does not pay itself", () => {
		it.each([
			["a paused template", { isActive: false }],
			["autoPay off", { autoPay: false }],
			["ASK with autoPay on", { amountMode: "ASK" }],
		] as const)("%s", async (_name, template) => {
			const store = baseStore({ template });
			expect(await planPosterRun(input(store))).toEqual({
				entries: [],
				stopped: "refused",
				refusal: "not_found",
			});
		});

		it("a template that is gone", async () => {
			const store = baseStore();
			expect(await planPosterRun(input(store, { template: null }))).toEqual({
				entries: [],
				stopped: "refused",
				refusal: "not_found",
			});
		});

		it("a template not yet due", async () => {
			const store = baseStore({ template: { nextDueDate: ba("2026-12-02") } });
			expect(await planPosterRun(input(store))).toEqual({
				entries: [],
				stopped: "caught_up",
			});
		});
	});

	it("auto-post off: the poster plans nothing", async () => {
		const store = baseStore();
		let read = false;
		const run = await planPosterRun(
			input(store, {
				autoPost: false,
				isProtected: async () => {
					read = true;
					return false;
				},
			}),
		);
		expect(run).toEqual({ entries: [], stopped: "auto_post_off" });
		expect(read).toBe(false);
	});

	describe("protection", () => {
		it("on at the start plans nothing", async () => {
			const store = baseStore(SEPT);
			const run = await planPosterRun(
				input(store, { now: NOV, isProtected: async () => true }),
			);
			expect(run).toEqual({ entries: [], stopped: "protected" });
		});

		it("a read that fails counts as on", async () => {
			const store = baseStore(SEPT);
			const run = await planPosterRun(
				input(store, {
					now: NOV,
					isProtected: async () => {
						throw new Error("offline");
					},
				}),
			);
			expect(run).toEqual({ entries: [], stopped: "protected" });
		});

		it("turning on after period 1 stops before period 2", async () => {
			const store = baseStore(SEPT);
			let reads = 0;
			const run = await planPosterRun(
				input(store, {
					now: NOV,
					// The first read is the start of the run, the second is before period 2.
					isProtected: async () => ++reads > 1,
				}),
			);
			expect(run.stopped).toBe("protected");
			expect(run.entries.map((e) => e.plan.entry.homeAmount)).toEqual([
				"30000.00",
			]);
		});
	});

	it("no rate for period 3 plans 1 and 2 and nothing after", async () => {
		const store = baseStore({
			template: { nextDueDate: ba("2026-07-01") },
			rates: [rate("2026-06-01", "ARS", "blue", 1545)],
		});
		store.missing = (currency, date) =>
			currency === "ARS" && date.getTime() === ba("2026-09-01").getTime();
		const run = await planPosterRun(input(store, { now: NOV }));
		expect(run.stopped).toBe("refused");
		expect(run.refusal).toBe("missing_rate");
		expect(run.entries.map((e) => e.dueAt.toISOString())).toEqual([
			"2026-07-01T03:00:00.000Z",
			"2026-08-01T03:00:00.000Z",
		]);
	});

	describe("the saved zone decides, never the phone's", () => {
		it("a 03:00Z Buenos Aires due date is not planned at 02:00Z", async () => {
			const store = baseStore();
			const run = await planPosterRun(
				input(store, { now: at("2026-12-01T02:00:00.000Z") }),
			);
			expect(run).toEqual({ entries: [], stopped: "caught_up" });
		});

		it("saved zone Tokyo: nothing at 2026-11-30T15:30Z, at 03:00Z one entry that steps to 2026-12-31T15:00Z", async () => {
			const store = baseStore({ zone: TOKYO });
			expect(
				(
					await planPosterRun(
						input(store, { now: at("2026-11-30T15:30:00.000Z") }),
					)
				).entries,
			).toEqual([]);
			const run = await planPosterRun(
				input(store, { now: at("2026-12-01T03:00:00.000Z") }),
			);
			expect(run.entries).toHaveLength(1);
			expect(run.entries[0]?.plan.nextDueDate).toEqual(
				at("2026-12-31T15:00:00.000Z"),
			);
		});
	});

	describe("a poster entry always carries its template stamp", () => {
		it("a template with no stamp yet plans nothing", async () => {
			const store = baseStore();
			const run = await planPosterRun(
				input(store, { template: { ...store.template, stamp: null } }),
			);
			expect(run).toEqual({ entries: [], stopped: "no_stamp" });
		});

		it("an entry cannot be built without one", async () => {
			const store = baseStore();
			const plan = await planConfirm(
				store.template,
				{ userId: ME, now: NOW, zone: BA, stepZone: BA },
				store.book,
			);
			// @ts-expect-error the stamp is required
			expect(() => posterEntry(plan, 0)).toThrow(PosterStampError);
			expect(() =>
				posterEntry(plan, 0, undefined as unknown as { version: string }),
			).toThrow(PosterStampError);
			expect(() => posterEntry(plan, 0, { version: "" })).toThrow(
				PosterStampError,
			);
			expect(() => posterEntry(plan, 0, { after: -1 })).toThrow(
				PosterStampError,
			);
			expect(() => posterEntry(plan, 0, { after: 0.5 })).toThrow(
				PosterStampError,
			);
			expect(posterEntry(plan, 0, { version: "v1" }).expectedStamp).toEqual({
				version: "v1",
			});
			expect(posterEntry(plan, 1, { after: 0 }).expectedStamp).toEqual({
				after: 0,
			});
		});

		it("the entry type requires expectedStamp", async () => {
			const store = baseStore();
			const plan = await planConfirm(
				store.template,
				{ userId: ME, now: NOW, zone: BA, stepZone: BA },
				store.book,
			);
			// @ts-expect-error expectedStamp is not optional
			const missing: PosterEntry = {
				origin: "poster",
				templateId: "t1",
				index: 0,
				dueAt: plan.dueAt,
				plan,
			};
			expect(missing.origin).toBe("poster");
		});
	});
});
