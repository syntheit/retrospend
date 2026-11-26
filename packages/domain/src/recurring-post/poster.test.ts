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

		it("a read that fails counts as on, reported as unreadable", async () => {
			const store = baseStore(SEPT);
			const run = await planPosterRun(
				input(store, {
					now: NOV,
					isProtected: async () => {
						throw new Error("offline");
					},
				}),
			);
			expect(run).toEqual({ entries: [], stopped: "protection_unreadable" });
		});

		it("a read that fails after period 1 stops the run as unreadable", async () => {
			const store = baseStore(SEPT);
			let reads = 0;
			const run = await planPosterRun(
				input(store, {
					now: NOV,
					isProtected: async () => {
						if (++reads > 1) throw new Error("offline");
						return false;
					},
				}),
			);
			expect(run.stopped).toBe("protection_unreadable");
			expect(run.entries).toHaveLength(1);
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

// An income template is a monthly USD 1,000 due 2026-12-01T00:00Z (a UTC
// midnight). It plans through the same planConfirm the server's sweep runs, so
// the entry is the sweep's row: money in, no leg. Rates: blue 1,545 from Nov 30
// (1,500 on Nov 1), so 1,000 x 1,545 = 1,545,000.00 (official, 1,050 from Dec
// 1, would give 1,050,000.00) and 1,000 x 1,500 = 1,500,000.00.
describe("planPosterRun over an income template", () => {
	const DUE = at("2026-12-01T00:00:00.000Z");
	const NEXT = at("2027-01-01T00:00:00.000Z");
	const income = { direction: "IN", amount: "1000", nextDueDate: DUE } as const;
	const incomeStore = (over: Parameters<typeof baseStore>[0] = {}) =>
		baseStore({ ...over, template: { ...income, ...over.template } });

	it("plans one money-in entry at the due instant's blue rate, stepping in UTC", async () => {
		const store = incomeStore();
		const run = await planPosterRun(input(store, { now: DUE }));
		expect(run.stopped).toBe("caught_up");
		expect(run.entries).toHaveLength(1);
		expect(run.entries[0]).toMatchObject({
			origin: "poster",
			dueAt: DUE,
			expectedStamp: { version: store.template.stamp },
			plan: {
				nextDueDate: NEXT,
				entry: {
					direction: "IN",
					inType: "INCOME",
					status: "FINALIZED",
					pricingSource: "RECURRING",
					amount: "1000",
					date: DUE,
					rateType: "blue",
					homeRate: "1545",
					homeAmount: "1545000.00",
					excludeFromAnalytics: false,
				},
			},
		});
	});

	it("plans what the sweep's confirm books, field for field", async () => {
		const run = await planPosterRun(input(incomeStore(), { now: DUE }));
		const server = await incomeStore().confirm(DUE, { dueAt: DUE, auto: true });
		expect(run.entries[0]?.plan).toEqual(server);
	});

	it("catches up at each due date's own rate, chained by stamp: 1,500,000.00 then 1,545,000.00", async () => {
		const store = incomeStore({
			template: { nextDueDate: at("2026-11-01T00:00:00.000Z") },
			rates: [
				rate("2026-11-01", "ARS", "blue", 1500),
				rate("2026-11-30", "ARS", "blue", 1545),
			],
		});
		const run = await planPosterRun(input(store, { now: NOW }));
		expect(run.stopped).toBe("caught_up");
		expect(run.entries.map((e) => e.plan.entry.homeAmount)).toEqual([
			"1500000.00",
			"1545000.00",
		]);
		expect(run.entries.map((e) => e.expectedStamp)).toEqual([
			{ version: store.template.stamp },
			{ after: 0 },
		]);
		expect(run.entries.at(-1)?.plan.nextDueDate).toEqual(NEXT);
	});

	describe("due instants in the saved zone", () => {
		const HONOLULU = "Pacific/Honolulu";

		it("Honolulu: nothing at 2026-11-30T23:59:59Z, one entry at 2026-12-01T00:00Z", async () => {
			const store = incomeStore({ zone: HONOLULU });
			expect(
				await planPosterRun(
					input(store, { now: at("2026-11-30T23:59:59.000Z") }),
				),
			).toEqual({ entries: [], stopped: "caught_up" });
			const run = await planPosterRun(input(store, { now: DUE }));
			expect(run.entries.map((e) => e.dueAt)).toEqual([DUE]);
		});

		it("Tokyo: nothing at 2026-11-30T15:00Z although Dec 1 has begun there, one entry at the UTC instant", async () => {
			const store = incomeStore({ zone: TOKYO });
			const early = at("2026-11-30T15:00:00.000Z");
			expect(await planPosterRun(input(store, { now: early }))).toEqual({
				entries: [],
				stopped: "caught_up",
			});
			// A person's confirm there is due (the start of the next day is Dec 1
			// 15:00Z, after the due instant); the poster waits for the instant.
			const confirm = await planConfirm(
				store.template,
				{ userId: ME, now: early, zone: TOKYO, stepZone: TOKYO },
				store.book,
			);
			expect(confirm.dueAt).toEqual(DUE);
			const run = await planPosterRun(input(store, { now: DUE }));
			expect(run.entries).toHaveLength(1);
		});

		it("a skip reads the UTC day: due at 2026-11-30T15:00Z in Tokyo, not at 2026-12-01T00:00Z in Honolulu", () => {
			expect(
				incomeStore({ zone: TOKYO }).skip(at("2026-11-30T15:00:00.000Z"), {
					zone: TOKYO,
					stepZone: TOKYO,
				}).dueAt,
			).toEqual(DUE);
			expect(() =>
				incomeStore({ zone: HONOLULU }).skip(DUE, {
					zone: HONOLULU,
					stepZone: HONOLULU,
				}),
			).toThrow(expect.objectContaining({ kind: "not_due" }));
		});
	});

	describe("the guards an expense template has", () => {
		it.each([
			["a paused template", { isActive: false }],
			["autoPay off", { autoPay: false }],
			["ASK with autoPay on", { amountMode: "ASK" }],
		] as const)("%s plans nothing", async (_name, template) => {
			const store = incomeStore({ template });
			expect(await planPosterRun(input(store, { now: DUE }))).toEqual({
				entries: [],
				stopped: "refused",
				refusal: "not_found",
			});
		});

		it("protection on plans nothing, and so does a read that fails", async () => {
			const store = incomeStore();
			expect(
				await planPosterRun(
					input(store, { now: DUE, isProtected: async () => true }),
				),
			).toEqual({ entries: [], stopped: "protected" });
			expect(
				await planPosterRun(
					input(store, {
						now: DUE,
						isProtected: async () => {
							throw new Error("offline");
						},
					}),
				),
			).toEqual({ entries: [], stopped: "protection_unreadable" });
		});

		it("a template with no version to name plans nothing, so no entry is stampless", async () => {
			const store = incomeStore();
			expect(
				await planPosterRun(
					input(store, {
						now: DUE,
						template: { ...store.template, stamp: null },
					}),
				),
			).toEqual({ entries: [], stopped: "no_stamp" });
		});

		it("a missing rate refuses the period and plans nothing, never at 1", async () => {
			const store = incomeStore({ rates: [] });
			const run = await planPosterRun(input(store, { now: DUE }));
			expect(run).toEqual({
				entries: [],
				stopped: "refused",
				refusal: "missing_rate",
			});
		});
	});
});
