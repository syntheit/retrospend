/**
 * planConfirm, planSkip and runCatchUp, against the fake store, on the vectors
 * the characterization tests pin on the server (recurring-write- and
 * recurring-sweep-characterization.pg.test.ts). Base case: home ARS,
 * preferred USD type blue, saved zone Buenos Aires (UTC-3), a monthly USD 20
 * template on the 1st due 2026-12-01T03:00Z. Hand-derived values:
 *   blue 1,545: USD 20 * 1,545 = ARS 30,900.00
 *   paid Nov 29 at blue 1,540: 20 * 1,540 = 30,800.00
 *   Catch-up due Sep 1, Oct 1, Nov 1 at blue 1,500, 1,520, 1,545:
 *     30,000.00 + 30,400.00 + 30,900.00 = 91,300.00 (1,545 for all: 92,700.00)
 *   Cap: a weekly template due from 2026-01-07T03:00Z, read at
 *     2026-10-10T12:00Z, has 40 periods (k = 0 to 39; k = 39 is Jan 7 + 273
 *     days = Oct 7). A run posts 31 (k = 0 to 30; 31 * 30,900 = 957,900.00)
 *     and rests at k = 31, Jan 7 + 217 days = Aug 12. The next run posts the
 *     other 9 (278,100.00), rests at Oct 14, total 1,236,000.00. Exactly 31
 *     due (read at Aug 10) is not capped: k = 30 is Jan 7 + 210 days = Aug 5.
 *   Zones: Dec 1 starts at 03:00Z in Buenos Aires, 2026-11-30T15:00Z in Tokyo
 *     (UTC+9), 00:00Z in UTC. A due check reads the request's zone; stepping
 *     reads the saved one. Jan 1 starts at 2026-12-31T15:00Z in Tokyo.
 */
import { describe, expect, it } from "vitest";
import {
	CATCH_UP_CAP,
	type ConfirmInput,
	planConfirm,
	planSkip,
	runCatchUp,
} from "./plan";
import { RecurringRefusal } from "./refusals";
import {
	at,
	BA,
	ba,
	baseStore,
	datesOf,
	homeOf,
	rate,
	TOKYO,
} from "./test-kit";

const NOW = at("2026-12-01T12:00:00.000Z");
const DUE = ba("2026-12-01");
const NEXT = ba("2027-01-01");
const ME = "me";

const timing = (over: Partial<ConfirmInput> = {}): ConfirmInput => ({
	userId: ME,
	now: NOW,
	zone: BA,
	stepZone: BA,
	dueAt: DUE,
	...over,
});

describe("planConfirm", () => {
	it("books USD 20 at blue 1,545 as ARS 30,900.00 and steps to Jan 1", async () => {
		const store = baseStore();
		const was = store.template.stamp;
		const plan = await store.confirm(NOW, { dueAt: DUE });
		expect(plan).toMatchObject({
			templateId: "t1",
			dueAt: DUE,
			nextDueDate: NEXT,
			anchorDay: 1,
			previousAnchorDay: 1,
		});
		expect(homeOf(store)).toEqual(["30900.00"]);
		expect(datesOf(store)).toEqual([DUE.toISOString()]);
		expect(store.template.nextDueDate).toEqual(NEXT);
		expect(store.template.stamp).not.toBe(was);
	});

	it("a paid-on day books that day's rate (30,800.00) and the template still steps from the due date", async () => {
		const store = baseStore();
		await store.confirm(NOW, { dueAt: DUE, paidOn: "2026-11-29" });
		expect(homeOf(store)).toEqual(["30800.00"]);
		expect(datesOf(store)).toEqual(["2026-11-29T03:00:00.000Z"]);
		expect(store.template.nextDueDate).toEqual(NEXT);
	});

	it("keeps the anchor through a short month: Jan 31 2028 to Feb 29, then Mar 31", async () => {
		const store = baseStore({
			template: { nextDueDate: ba("2028-01-31"), anchorDay: 31 },
			rates: [rate("2026-01-01", "ARS", "blue", 1545)],
		});
		await store.confirm(at("2028-02-01T12:00:00.000Z"));
		expect(store.template.nextDueDate).toEqual(ba("2028-02-29"));
		expect(store.template.anchorDay).toBe(31);
		await store.confirm(at("2028-03-01T12:00:00.000Z"));
		expect(store.template.nextDueDate).toEqual(ba("2028-03-31"));
	});

	it("Jan 31 2027 steps to Feb 28 2027", async () => {
		const store = baseStore({
			template: { nextDueDate: ba("2027-01-31"), anchorDay: 31 },
			rates: [rate("2026-01-01", "ARS", "blue", 1545)],
		});
		await store.confirm(at("2027-02-01T12:00:00.000Z"));
		expect(store.template.nextDueDate).toEqual(ba("2027-02-28"));
	});

	describe("refusals, in the order the server answers them", () => {
		const GONE = ["not_found", "Recurring template not found"] as const;
		const POSTED = [
			"already_posted",
			"This payment was already confirmed",
		] as const;
		const NOT_DUE = ["not_due", "This payment was already confirmed"] as const;
		const BEFORE_DUE = at("2026-12-01T02:00:00.000Z");

		const cases: {
			name: string;
			template?: object;
			input?: Partial<ConfirmInput>;
			want: readonly [string, string];
		}[] = [
			{
				name: "another user's template",
				template: { userId: "other" },
				want: GONE,
			},
			{ name: "a paused template", template: { isActive: false }, want: GONE },
			{
				name: "a paused template with a stale dueAt is not found, not a conflict",
				template: { isActive: false },
				input: { dueAt: ba("2026-11-01") },
				want: GONE,
			},
			{
				name: "a dueAt one period back",
				input: { dueAt: ba("2026-11-01") },
				want: POSTED,
			},
			{
				name: "a dueAt one period ahead",
				input: { dueAt: NEXT },
				want: POSTED,
			},
			{
				name: "a day that has not started",
				input: { now: BEFORE_DUE },
				want: NOT_DUE,
			},
			{
				name: "a day that starts one millisecond later",
				input: { now: at("2026-12-01T02:59:59.999Z") },
				want: NOT_DUE,
			},
			{
				name: "not due and ask-me with no amount: not due answers first",
				template: { amountMode: "ASK" },
				input: { now: BEFORE_DUE },
				want: NOT_DUE,
			},
			{
				name: "a stale dueAt and ask-me with no amount: the dueAt answers first",
				template: { amountMode: "ASK" },
				input: { dueAt: NEXT },
				want: POSTED,
			},
			{
				name: "not due and paid on tomorrow: not due answers first",
				input: { now: BEFORE_DUE, paidOn: "2026-12-02" },
				want: NOT_DUE,
			},
			{
				name: "a paused ask-me template with no amount is not found",
				template: { isActive: false, amountMode: "ASK" },
				want: GONE,
			},
		];

		it.each(cases)("$name", async (c) => {
			const store = baseStore({ template: c.template });
			const before = store.template;
			await expect(store.confirm(NOW, { ...c.input })).rejects.toMatchObject({
				constructor: RecurringRefusal,
				kind: c.want[0],
				message: c.want[1],
			});
			expect(store.template).toBe(before);
			expect(store.expenses).toEqual([]);
		});

		it("an absent template is not found", async () => {
			await expect(
				planConfirm(null, timing(), baseStore().book),
			).rejects.toMatchObject({ kind: "not_found", message: GONE[1] });
		});

		it.each([
			["ask-me with no amount", { amountMode: "ASK" }, {}, "amount_required"],
			[
				"a fixed template given an amount",
				{},
				{ confirmedAmount: "18.50" },
				"amount_fixed",
			],
			["paid on tomorrow", {}, { paidOn: "2026-12-02" }, "date_in_future"],
			[
				"paid before the previous due day",
				{},
				{ paidOn: "2026-10-31" },
				"date_before_previous_due",
			],
			[
				"paid on tomorrow and ask-me with no amount: the day answers first",
				{ amountMode: "ASK" },
				{ paidOn: "2026-12-02" },
				"date_in_future",
			],
		] as const)("%s is a bad request", async (_name, template, input, kind) => {
			const store = baseStore({ template });
			await expect(store.confirm(NOW, input)).rejects.toMatchObject({
				name: "RecurringInputRefusal",
				kind,
			});
			expect(store.expenses).toEqual([]);
		});

		it("a currency with no rate throws MissingRateError and books nothing", async () => {
			const store = baseStore({ template: { currency: "COP" } });
			await expect(store.confirm(NOW)).rejects.toMatchObject({
				name: "MissingRateError",
			});
			expect(store.expenses).toEqual([]);
		});
	});

	describe("an auto post needs the template to still pay itself", () => {
		it("autoPay off plans nothing", async () => {
			const store = baseStore({ template: { autoPay: false } });
			await expect(store.confirm(NOW, { auto: true })).rejects.toMatchObject({
				kind: "not_found",
			});
			expect(store.expenses).toEqual([]);
		});

		it("ASK plans nothing with autoPay on", async () => {
			const store = baseStore({ template: { amountMode: "ASK" } });
			await expect(store.confirm(NOW, { auto: true })).rejects.toMatchObject({
				kind: "not_found",
			});
			expect(store.expenses).toEqual([]);
		});

		it("a manual confirm does not need auto-pay", async () => {
			const store = baseStore({ template: { autoPay: false } });
			await store.confirm(NOW);
			expect(homeOf(store)).toEqual(["30900.00"]);
		});
	});

	describe("the template stamp", () => {
		it("a stale stamp is changed, and nothing is booked", async () => {
			const store = baseStore();
			const seen = store.template.stamp;
			store.edit({ amount: "25" });
			await expect(
				store.confirm(NOW, { expectedStamp: seen }),
			).rejects.toMatchObject({
				kind: "changed",
				message: "Recurring expense changed",
			});
			expect(store.expenses).toEqual([]);
		});

		it("the current stamp books, and a call with no stamp is not compared", async () => {
			const store = baseStore();
			const seen = store.template.stamp;
			await store.confirm(NOW, { expectedStamp: seen });
			expect(store.expenses).toHaveLength(1);
			const other = baseStore();
			other.edit({ amount: "25" });
			await other.confirm(NOW);
			expect(homeOf(other)).toEqual(["38625.00"]);
		});

		it("a stale dueAt answers already_posted before a stale stamp", async () => {
			const store = baseStore();
			const seen = store.template.stamp;
			store.edit({ nextDueDate: NEXT });
			await expect(
				store.confirm(NOW, { dueAt: DUE, expectedStamp: seen }),
			).rejects.toMatchObject({ kind: "already_posted" });
		});

		it("a paused template with a stale stamp is not found", async () => {
			const store = baseStore();
			const seen = store.template.stamp;
			store.edit({ isActive: false });
			await expect(
				store.confirm(NOW, { expectedStamp: seen }),
			).rejects.toMatchObject({ kind: "not_found" });
		});

		it("a template with no stamp yet never matches one", async () => {
			const store = baseStore();
			await expect(
				planConfirm(
					{ ...store.template, stamp: null },
					timing({ expectedStamp: "v1" }),
					store.book,
				),
			).rejects.toMatchObject({ kind: "changed" });
		});
	});

	describe("zones", () => {
		it("Buenos Aires: refused at 02:59:59.999Z, books at 03:00:00.000Z", async () => {
			const store = baseStore();
			await expect(
				store.confirm(at("2026-12-01T02:59:59.999Z")),
			).rejects.toMatchObject({ kind: "not_due" });
			await store.confirm(at("2026-12-01T03:00:00.000Z"));
			expect(store.expenses).toHaveLength(1);
		});

		it("the request's zone decides: Tokyo at 2026-11-30T15:30Z books the Buenos Aires day, Buenos Aires does not", async () => {
			const now = at("2026-11-30T15:30:00.000Z");
			await expect(baseStore().confirm(now)).rejects.toMatchObject({
				kind: "not_due",
			});
			const store = baseStore();
			await store.confirm(now, { zone: TOKYO });
			// Booked on the due date, stepped in the saved zone (Buenos Aires).
			expect(datesOf(store)).toEqual([DUE.toISOString()]);
			expect(store.template.nextDueDate).toEqual(NEXT);
		});

		it("UTC at 02:00Z on Dec 1 passes the due check, though it is 23:00 on Nov 30 in Buenos Aires", async () => {
			const store = baseStore();
			await store.confirm(at("2026-12-01T02:00:00.000Z"), { zone: "UTC" });
			expect(store.expenses).toHaveLength(1);
		});

		it("saved zone Tokyo steps Dec 1 to 2026-12-31T15:00Z, not Buenos Aires' Jan 1", async () => {
			const store = baseStore({ zone: TOKYO });
			await store.confirm(at("2026-11-30T15:30:00.000Z"));
			expect(store.template.nextDueDate).toEqual(
				at("2026-12-31T15:00:00.000Z"),
			);
			expect(store.template.anchorDay).toBe(1);
			expect(homeOf(store)).toEqual(["30900.00"]);
		});
	});

	it("a lost race is already_posted and books nothing", async () => {
		const store = baseStore();
		// Another client posts the period between this call's read and its write.
		store.beforeWrite = () => store.edit({ nextDueDate: NEXT });
		await expect(store.confirm(NOW, { dueAt: DUE })).rejects.toMatchObject({
			kind: "already_posted",
			message: "This payment was already confirmed",
		});
		expect(store.expenses).toEqual([]);
	});

	it("recurring income books as money in, on its UTC day, and steps in UTC days", async () => {
		const day = at("2026-12-01T00:00:00.000Z");
		const store = baseStore({
			template: { direction: "IN", anchorDay: null, nextDueDate: day },
		});
		// 17:00 on Nov 30 in Buenos Aires: a confirm asks "has its day started"
		// of the start of the next day, so it books.
		await store.confirm(at("2026-11-30T20:00:00.000Z"), { dueAt: day });
		expect(store.expenses[0]).toMatchObject({
			direction: "IN",
			inType: "INCOME",
			date: day,
		});
		expect(store.template.nextDueDate).toEqual(at("2027-01-01T00:00:00.000Z"));
		expect(store.template.anchorDay).toBe(1);
	});
});

describe("planSkip", () => {
	it("steps to Jan 1 and books nothing", () => {
		const store = baseStore();
		const plan = store.skip(NOW, { dueAt: DUE });
		expect(plan).toEqual({
			templateId: "t1",
			dueAt: DUE,
			nextDueDate: NEXT,
			anchorDay: 1,
		});
		expect(store.template.nextDueDate).toEqual(NEXT);
		expect(store.expenses).toEqual([]);
	});

	const POSTED = [
		"already_posted",
		"This item was already confirmed or skipped",
	];
	it.each([
		[
			"another user's template",
			{ userId: "other" },
			{},
			["not_found", "Recurring template not found"],
		],
		[
			"a paused template",
			{ isActive: false },
			{},
			["not_found", "Recurring template not found"],
		],
		[
			"a paused template with a stale dueAt",
			{ isActive: false },
			{ dueAt: ba("2026-11-01") },
			["not_found", "Recurring template not found"],
		],
		["a dueAt one period back", {}, { dueAt: ba("2026-11-01") }, POSTED],
		["a dueAt one period ahead", {}, { dueAt: NEXT }, POSTED],
		[
			"a day that has not started",
			{},
			{ now: at("2026-12-01T02:59:59.999Z") },
			["not_due", "This item was already confirmed or skipped"],
		],
		[
			"a stale dueAt on an ask-me template",
			{ amountMode: "ASK" },
			{ dueAt: NEXT },
			POSTED,
		],
	] as const)("refuses %s", (_name, template, input, want) => {
		const store = baseStore({ template });
		const before = store.template;
		expect(() => store.skip(NOW, { ...input })).toThrowError(
			expect.objectContaining({ kind: want[0], message: want[1] }),
		);
		expect(store.template).toBe(before);
	});

	it("a stale stamp is changed", () => {
		const store = baseStore();
		const seen = store.template.stamp;
		store.edit({ amount: "25" });
		expect(() => store.skip(NOW, { expectedStamp: seen })).toThrowError(
			expect.objectContaining({ kind: "changed" }),
		);
		expect(store.template.nextDueDate).toEqual(DUE);
	});

	it("a lost race is already_posted", () => {
		const store = baseStore();
		store.beforeWrite = () => store.edit({ nextDueDate: NEXT });
		expect(() => store.skip(NOW, { dueAt: DUE })).toThrowError(
			expect.objectContaining({
				kind: "already_posted",
				message: "This item was already confirmed or skipped",
			}),
		);
	});

	it("income is due by its UTC day in the zone's calendar: refused until the zone's Dec 1 starts, allowed at midnight", () => {
		const day = at("2026-12-01T00:00:00.000Z");
		const salary = {
			direction: "IN",
			anchorDay: null,
			nextDueDate: day,
		} as const;
		expect(() =>
			baseStore({ template: salary }).skip(at("2026-12-01T02:59:59.999Z")),
		).toThrowError(expect.objectContaining({ kind: "not_due" }));
		expect(() =>
			baseStore({ template: salary }).skip(at("2026-11-30T20:00:00.000Z")),
		).toThrowError(expect.objectContaining({ kind: "not_due" }));
		const store = baseStore({ template: salary });
		store.skip(at("2026-12-01T03:00:00.000Z"));
		expect(store.template.nextDueDate).toEqual(at("2027-01-01T00:00:00.000Z"));
	});

	it("planSkip on no template is not found", () => {
		expect(() => planSkip(null, timing())).toThrowError(
			expect.objectContaining({ kind: "not_found" }),
		);
	});
});

describe("runCatchUp", () => {
	const posted = (r: { posted: boolean }) => r.posted;

	it("books each missed period at its own due date's rate: 30,000 + 30,400 + 30,900 = 91,300", async () => {
		const now = at("2026-11-01T12:00:00.000Z");
		const store = baseStore({
			template: { nextDueDate: ba("2026-09-01") },
			rates: [
				rate("2026-09-01", "ARS", "blue", 1500),
				rate("2026-10-01", "ARS", "blue", 1520),
				rate("2026-11-01", "ARS", "blue", 1545),
			],
		});
		const run = await runCatchUp(store.catchUpPort(now), ba("2026-09-01"), now);
		expect(run.stopped).toBe("caught_up");
		expect(run.results.every(posted)).toBe(true);
		expect(homeOf(store)).toEqual(["30000.00", "30400.00", "30900.00"]);
		expect(homeOf(store).reduce((sum, h) => sum + Number(h), 0)).toBe(91_300);
		expect(datesOf(store)).toEqual([
			"2026-09-01T03:00:00.000Z",
			"2026-10-01T03:00:00.000Z",
			"2026-11-01T03:00:00.000Z",
		]);
		expect(store.template.nextDueDate).toEqual(DUE);
	});

	describe("the cap", () => {
		const weekly = {
			template: {
				frequency: "WEEKLY",
				anchorDay: null,
				nextDueDate: ba("2026-01-07"),
			},
			rates: [rate("2026-01-01", "ARS", "blue", 1545)],
		} as const;
		const total = (homes: string[]) => homes.reduce((s, h) => s + Number(h), 0);

		it("CATCH_UP_CAP is 31", () => {
			expect(CATCH_UP_CAP).toBe(31);
		});

		it("40 weekly periods: one run posts 31 and reports capped, the next posts the other 9", async () => {
			const now = at("2026-10-10T12:00:00.000Z");
			const store = baseStore(weekly);
			const first = await runCatchUp(
				store.catchUpPort(now),
				store.template.nextDueDate,
				now,
			);
			expect(first.stopped).toBe("cap");
			expect(first.results).toHaveLength(31);
			expect(store.template.nextDueDate).toEqual(
				at("2026-08-12T03:00:00.000Z"),
			);
			expect(total(homeOf(store))).toBe(957_900);

			const second = await runCatchUp(
				store.catchUpPort(now),
				store.template.nextDueDate,
				now,
			);
			expect(second.stopped).toBe("caught_up");
			expect(second.results).toHaveLength(9);
			expect(store.template.nextDueDate).toEqual(
				at("2026-10-14T03:00:00.000Z"),
			);
			expect(total(homeOf(store))).toBe(1_236_000);
			expect(new Set(datesOf(store)).size).toBe(40);
		});

		it("exactly 31 due is caught up, not capped", async () => {
			const now = at("2026-08-10T12:00:00.000Z");
			const store = baseStore(weekly);
			const run = await runCatchUp(
				store.catchUpPort(now),
				store.template.nextDueDate,
				now,
			);
			expect(run.results).toHaveLength(31);
			expect(run.stopped).toBe("caught_up");
		});
	});

	describe("the due instant gate", () => {
		it("UTC device at 02:00Z does not post a 03:00Z Buenos Aires due date", async () => {
			const now = at("2026-12-01T02:00:00.000Z");
			const store = baseStore();
			const run = await runCatchUp(store.catchUpPort(now), DUE, now);
			expect(run).toEqual({ results: [], stopped: "caught_up" });
			expect(store.expenses).toEqual([]);
			const later = at("2026-12-01T03:00:00.000Z");
			await runCatchUp(store.catchUpPort(later), DUE, later);
			expect(homeOf(store)).toEqual(["30900.00"]);
		});

		it("holds in a Tokyo-saved zone: nothing at 2026-11-30T15:30Z though Dec 1 has started there", async () => {
			const early = at("2026-11-30T15:30:00.000Z");
			const store = baseStore({ zone: TOKYO });
			expect(await runCatchUp(store.catchUpPort(early), DUE, early)).toEqual({
				results: [],
				stopped: "caught_up",
			});
			expect(store.expenses).toEqual([]);
			const due = at("2026-12-01T03:00:00.000Z");
			await runCatchUp(store.catchUpPort(due), DUE, due);
			expect(store.template.nextDueDate).toEqual(
				at("2026-12-31T15:00:00.000Z"),
			);
		});
	});

	describe("it stops where the next period cannot post", () => {
		const SEP = "2026-09-01T03:00:00.000Z";
		const OCT = ba("2026-10-01");
		const now = at("2026-11-01T12:00:00.000Z");
		const sept = () =>
			baseStore({
				template: { nextDueDate: ba("2026-09-01") },
				rates: [rate("2026-06-01", "ARS", "blue", 1545)],
			});

		it.each([
			["auto-pay turned off between periods", { autoPay: false }],
			["paused between periods", { isActive: false }],
			["switched to ask-me between periods", { amountMode: "ASK" }],
		] as const)(
			"%s: period 1 posts, period 2 is refused, the template rests on Oct 1",
			async (_name, change) => {
				const store = sept();
				let moved = false;
				store.beforeWrite = () => {
					if (moved) return;
					moved = true;
					store.edit(change);
				};
				const run = await runCatchUp(
					store.catchUpPort(now),
					ba("2026-09-01"),
					now,
				);
				expect(run.stopped).toBe("refused");
				expect(run.results).toEqual([
					{ posted: true, nextDueDate: OCT },
					{ posted: false, outcome: "raced" },
				]);
				expect(datesOf(store)).toEqual([SEP]);
				expect(store.template.nextDueDate).toEqual(OCT);
			},
		);

		it("protection on after period 1 stops before period 2, with no failure", async () => {
			const store = sept();
			store.afterPost = () => {
				store.protectedAccount = true;
			};
			const run = await runCatchUp(
				store.catchUpPort(now),
				ba("2026-09-01"),
				now,
			);
			expect(run.stopped).toBe("protected");
			expect(run.results).toEqual([{ posted: true, nextDueDate: OCT }]);
			expect(datesOf(store)).toEqual([SEP]);
		});

		it("a protection read that fails counts as protected", async () => {
			const store = sept();
			const port = {
				...store.catchUpPort(now),
				isProtected: async () => {
					throw new Error("read failed");
				},
			};
			const run = await runCatchUp(port, ba("2026-09-01"), now);
			expect(run.stopped).toBe("protected");
			expect(run.results).toHaveLength(1);
		});

		it("no rate for period 3 posts 1 and 2 and nothing after, and the next run finishes", async () => {
			const store = baseStore({
				template: { nextDueDate: ba("2026-07-01") },
				rates: [rate("2026-06-01", "ARS", "blue", 1545)],
			});
			store.missing = (currency, date) =>
				currency === "ARS" && date.getTime() === ba("2026-09-01").getTime();
			const run = await runCatchUp(
				store.catchUpPort(now),
				ba("2026-07-01"),
				now,
			);
			expect(run.stopped).toBe("refused");
			expect(run.results.map((r) => r.posted)).toEqual([true, true, false]);
			expect(run.results[2]).toEqual({ posted: false, outcome: "missingRate" });
			expect(datesOf(store)).toEqual([
				"2026-07-01T03:00:00.000Z",
				"2026-08-01T03:00:00.000Z",
			]);
			expect(store.template.nextDueDate).toEqual(ba("2026-09-01"));

			store.missing = undefined;
			const again = await runCatchUp(
				store.catchUpPort(now),
				store.template.nextDueDate,
				now,
			);
			expect(again.results).toHaveLength(3);
			expect(store.template.nextDueDate).toEqual(DUE);
		});
	});
});
