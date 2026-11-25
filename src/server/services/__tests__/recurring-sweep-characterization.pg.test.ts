/**
 * What the recurring auto-post sweep does today, pinned before the plan-post
 * refactor (slice-device-recurring.md, PR0). Companion of
 * recurring-write-characterization.pg.test.ts, which pins the manual confirm
 * and skip; the sweep posts through the same confirm with `auto: true`.
 *
 * Home ARS, preferred USD type blue, saved zone Buenos Aires (UTC-3, no DST),
 * a monthly USD 20 template on the 1st. Hand-derived values:
 *   blue 1,545: USD 20 * 1,545 = ARS 30,900.00; official 1,050: 20 * 1,050 = 21,000.00
 *   Catch-up at each due date's rate, due Sep 1, Oct 1, Nov 1 2026 (03:00Z)
 *     at blue 1,500, 1,520, 1,545: 30,000 + 30,400 + 30,900 = 91,300.00
 *     (today's 1,545 for all three would give 3 * 30,900 = 92,700.00)
 *   Cap: a weekly USD 20 template due Wednesdays from 2026-01-07T03:00Z, read
 *     at 2026-10-10T12:00Z, has 40 periods (Jan 7 + 7k days, k = 0 to 39; k = 39
 *     is Jan 7 + 273 days = Oct 7, and Oct 14 is after "now"). A pass posts 31
 *     (k = 0 to 30) and the template rests at k = 31, Jan 7 + 217 days = Aug 12:
 *     31 * 30,900 = 957,900.00. The next pass posts the other 9: 9 * 30,900 =
 *     278,100.00, the next due date is Oct 14, and the total is 1,236,000.00.
 *   Zones: Dec 1 starts at 03:00Z in Buenos Aires. In Tokyo (UTC+9) a due
 *     instant of 03:00Z is 12:00 on Dec 1, and the next due date, the start of
 *     Jan 1 there, is 2026-12-31T15:00Z.
 */
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { adminDb, fixtureDb, fixtureNameIndex } from "~/test/pg-harness";
import {
	AUTO_POST_STATUS_KEY,
	type RecurringAutoPostResult,
	sweepRecurringAutoPost,
} from "../recurring-auto-post";
import {
	arsUser,
	BA,
	ba,
	booked,
	iso,
	STAMPED,
	setRates,
	TOKYO,
	templateState,
	usdTemplate,
} from "./recurring-write-kit";

// The real state read, with a hook that runs just before it: a test flips the
// state at a chosen step.
const watch = vi.hoisted(() => ({
	before: undefined as undefined | ((userId: string) => Promise<void>),
}));
vi.mock("~/server/services/protection/now", async (importOriginal) => {
	const real =
		await importOriginal<typeof import("~/server/services/protection/now")>();
	return {
		isProtectedNow: async (userId: string) => {
			await watch.before?.(userId);
			return real.isProtectedNow(userId);
		},
	};
});

// The real rate lookup, except for the pairs a test says have no rate. A real
// table cannot make a gap in the middle of a catch-up: the lookup falls back
// to the nearest row, so the only way to reach it is to cut the lookup.
const finder = vi.hoisted(() => ({
	missing: undefined as undefined | ((currency: string, date: Date) => boolean),
}));
vi.mock("~/server/exchange-rates", async (importOriginal) => {
	const real = await importOriginal<typeof import("~/server/exchange-rates")>();
	return {
		...real,
		findExchangeRate: (
			...args: Parameters<typeof real.findExchangeRate>
		): ReturnType<typeof real.findExchangeRate> =>
			finder.missing?.(args[1], args[2])
				? Promise.resolve(null)
				: real.findExchangeRate(...args),
	};
});

const NONE: RecurringAutoPostResult = {
	posted: 0,
	raced: 0,
	missingRate: 0,
	retry: 0,
	capped: 0,
	failed: 0,
};

afterEach(() => {
	vi.useRealTimers();
	watch.before = undefined;
	finder.missing = undefined;
});
afterAll(() => vi.restoreAllMocks());

type Source = Parameters<typeof sweepRecurringAutoPost>[1];

/** The real id read, kept to `userIds`; `then` runs after the read, before any post. */
function only(userIds: string[], then?: () => Promise<unknown>): Source {
	return {
		$queryRaw: (async (...args: Parameters<typeof adminDb.$queryRaw>) => {
			const rows = (await adminDb.$queryRaw(...args)) as { userId: string }[];
			await then?.();
			return rows.filter((r) => userIds.includes(r.userId));
		}) as typeof adminDb.$queryRaw,
	};
}

function sweep(now: string, userIds: string[], then?: () => Promise<unknown>) {
	const at = new Date(now);
	vi.useFakeTimers({ toFake: ["Date"], now: at });
	return sweepRecurringAutoPost(at, only(userIds, then));
}

const dueOf = async (id: string) => (await templateState(id)).nextDueDate;

const row = (id: string, extra: object = {}) => ({
	title: "Rent",
	date: "2026-12-01T03:00:00.000Z",
	amount: "20",
	currency: "USD",
	usd: "20",
	rate: "1",
	rateType: "blue",
	homeCurrency: "ARS",
	homeRate: "1545",
	home: "30900",
	pricingSource: "RECURRING",
	status: "FINALIZED",
	direction: "OUT",
	inType: null,
	categoryId: null,
	excludeFromAnalytics: false,
	recurringTemplateId: id,
	...extra,
});

const DUE = "2026-12-01T03:00:00.000Z";
const NEXT = "2027-01-01T03:00:00.000Z";
const NOW = "2026-12-01T12:00:00.000Z";

describe("a due template posts the confirm's row", () => {
	beforeAll(() =>
		setRates([
			["2026-11-30", "ARS", "blue", "1545"],
			["2026-12-01", "ARS", "official", "1050"],
		]),
	);

	it("USD 20 at blue 1,545 is ARS 30,900.00; the template moves to Jan 1 and @updatedAt moves", async () => {
		const me = await arsUser();
		const id = await usdTemplate(me);
		expect(await sweep(NOW, [me])).toEqual({ ...NONE, posted: 1 });
		expect(await booked(me)).toEqual([row(id)]);
		const after = await templateState(id);
		expect(after).toMatchObject({
			nextDueDate: NEXT,
			anchorDay: 1,
			expenses: 1,
		});
		expect(new Date(after.updatedAt).getTime()).toBeGreaterThan(
			STAMPED.getTime(),
		);
	});

	it("a user who prefers official gets ARS 21,000.00 (20 * 1,050)", async () => {
		const me = await arsUser(BA, "official");
		const id = await usdTemplate(me);
		await sweep(NOW, [me]);
		expect(await booked(me)).toEqual([
			row(id, { rateType: "official", homeRate: "1050", home: "21000" }),
		]);
	});

	it("an excludeByDefault category does not reach the row: excludeFromAnalytics stays false", async () => {
		const me = await arsUser();
		const category = await fixtureDb.category.create({
			data: {
				userId: me,
				name: "Transfers",
				color: "emerald",
				excludeByDefault: true,
				nameIndex: await fixtureNameIndex(me, "Transfers"),
			},
		});
		const id = await usdTemplate(me, { categoryId: category.id });
		await sweep(NOW, [me]);
		expect(await booked(me)).toEqual([row(id, { categoryId: category.id })]);
	});
});

describe("the due instant, not the day, decides when the sweep posts", () => {
	beforeAll(() => setRates([["2026-11-30", "ARS", "blue", "1545"]]));

	it("Buenos Aires: nothing at 02:59:59.999Z, one post at 03:00:00.000Z", async () => {
		const me = await arsUser();
		const id = await usdTemplate(me);
		expect(await sweep("2026-12-01T02:59:59.999Z", [me])).toEqual(NONE);
		expect(await templateState(id)).toMatchObject({
			nextDueDate: DUE,
			expenses: 0,
		});
		expect(await sweep(DUE, [me])).toEqual({ ...NONE, posted: 1 });
		expect(await booked(me)).toEqual([row(id)]);
		expect(await dueOf(id)).toBe(NEXT);
	});

	it("saved zone Tokyo: nothing at 2026-11-30T15:30Z (Dec 1, 00:30 there) though the day has started; posts at 03:00Z and steps to 2026-12-31T15:00Z", async () => {
		const me = await arsUser(TOKYO);
		const id = await usdTemplate(me);
		expect(await sweep("2026-11-30T15:30:00.000Z", [me])).toEqual(NONE);
		expect(await sweep(DUE, [me])).toEqual({ ...NONE, posted: 1 });
		expect(await booked(me)).toEqual([row(id)]);
		expect(await dueOf(id)).toBe("2026-12-31T15:00:00.000Z");
	});
});

describe("catch-up", () => {
	it("books each missed period at its own due date's rate: 30,000 + 30,400 + 30,900", async () => {
		await setRates([
			["2026-09-01", "ARS", "blue", "1500"],
			["2026-10-01", "ARS", "blue", "1520"],
			["2026-11-01", "ARS", "blue", "1545"],
		]);
		const me = await arsUser();
		const id = await usdTemplate(me, { nextDueDate: ba("2026-09-01") });
		expect(await sweep("2026-11-01T12:00:00.000Z", [me])).toEqual({
			...NONE,
			posted: 3,
		});
		expect((await booked(me)).map((r) => [r.date, r.homeRate, r.home])).toEqual(
			[
				["2026-09-01T03:00:00.000Z", "1500", "30000"],
				["2026-10-01T03:00:00.000Z", "1520", "30400"],
				["2026-11-01T03:00:00.000Z", "1545", "30900"],
			],
		);
		expect(await dueOf(id)).toBe(DUE);
	});

	it("posts 31 of 40 periods and counts capped 1, then the other 9 in the next pass", async () => {
		await setRates([["2026-01-01", "ARS", "blue", "1545"]]);
		const me = await arsUser();
		const id = await usdTemplate(me, {
			frequency: "WEEKLY",
			anchorDay: null,
			nextDueDate: ba("2026-01-07"),
		});
		const now = "2026-10-10T12:00:00.000Z";
		const total = async () =>
			(await booked(me)).reduce((sum, r) => sum + Number(r.home), 0);

		expect(await sweep(now, [me])).toEqual({ ...NONE, posted: 31, capped: 1 });
		expect(await dueOf(id)).toBe("2026-08-12T03:00:00.000Z");
		expect(await total()).toBe(957_900);

		expect(await sweep(now, [me])).toEqual({ ...NONE, posted: 9 });
		expect(await dueOf(id)).toBe("2026-10-14T03:00:00.000Z");
		expect(await total()).toBe(1_236_000);
		const dates = (await booked(me)).map((r) => r.date);
		expect(new Set(dates).size).toBe(40);
		expect(dates[0]).toBe("2026-01-07T03:00:00.000Z");
		expect(dates[31]).toBe("2026-08-12T03:00:00.000Z");
		expect(dates.at(-1)).toBe("2026-10-07T03:00:00.000Z");
	});
});

describe("what the sweep leaves alone", () => {
	beforeAll(() => setRates([["2026-06-01", "ARS", "blue", "1545"]]));

	it("a paused template, a manual one, an ask-me one and one not yet due", async () => {
		const me = await arsUser();
		const ids = [
			await usdTemplate(me, { isActive: false }),
			await usdTemplate(me, { autoPay: false }),
			await usdTemplate(me, { amountMode: "ASK" }),
			await usdTemplate(me, { nextDueDate: ba("2026-12-02") }),
		];
		expect(await sweep(NOW, [me])).toEqual(NONE);
		expect(await booked(me)).toEqual([]);
		for (const id of ids.slice(0, 3)) expect(await dueOf(id)).toBe(DUE);
		expect(await dueOf(ids[3] as string)).toBe("2026-12-02T03:00:00.000Z");
	});

	it.each([
		["paused", { isActive: false }],
		["set to manual", { autoPay: false }],
		["set to ask-me", { amountMode: "ASK" as const }],
	])(
		"a template %s after the due list was read is raced, not posted",
		async (_label, change) => {
			const me = await arsUser();
			const id = await usdTemplate(me);
			const flip = () =>
				fixtureDb.recurringTemplate.update({ where: { id }, data: change });
			expect(await sweep(NOW, [me], flip)).toEqual({ ...NONE, raced: 1 });
			expect(await booked(me)).toEqual([]);
			expect(await dueOf(id)).toBe(DUE);
		},
	);

	it("a currency with no rate posts nothing and leaves the template where it was", async () => {
		const me = await arsUser();
		const id = await usdTemplate(me, { currency: "COP", amount: "9000" });
		expect(await sweep(NOW, [me])).toEqual({ ...NONE, missingRate: 1 });
		expect(await booked(me)).toEqual([]);
		expect(await templateState(id)).toMatchObject({
			nextDueDate: DUE,
			updatedAt: iso(STAMPED),
			expenses: 0,
		});
	});
});

describe("a catch-up stops where the next period cannot post", () => {
	beforeAll(() => setRates([["2026-06-01", "ARS", "blue", "1545"]]));
	const SEP = "2026-09-01T03:00:00.000Z";
	const OCT = "2026-10-01T03:00:00.000Z";
	const NOV_NOW = "2026-11-01T12:00:00.000Z";

	/** Runs `change` just before the check that follows the first period's post. */
	function afterFirstPeriod(me: string, change: () => Promise<unknown>) {
		watch.before = async (userId) => {
			if (
				userId === me &&
				(await fixtureDb.expense.count({ where: { userId } })) > 0
			)
				await change();
		};
	}

	it("auto-pay turned off between periods: period 1 posts, period 2 is raced, the template rests on Oct 1", async () => {
		const me = await arsUser();
		const id = await usdTemplate(me, { nextDueDate: ba("2026-09-01") });
		afterFirstPeriod(me, () =>
			fixtureDb.recurringTemplate.update({
				where: { id },
				data: { autoPay: false },
			}),
		);
		expect(await sweep(NOV_NOW, [me])).toEqual({
			...NONE,
			posted: 1,
			raced: 1,
		});
		expect((await booked(me)).map((r) => r.date)).toEqual([SEP]);
		expect(await dueOf(id)).toBe(OCT);
	});

	it("paused between periods: the same stop", async () => {
		const me = await arsUser();
		const id = await usdTemplate(me, { nextDueDate: ba("2026-09-01") });
		afterFirstPeriod(me, () =>
			fixtureDb.recurringTemplate.update({
				where: { id },
				data: { isActive: false },
			}),
		);
		expect(await sweep(NOV_NOW, [me])).toEqual({
			...NONE,
			posted: 1,
			raced: 1,
		});
		expect(await dueOf(id)).toBe(OCT);
	});

	it("switched to ask-me between periods: the same stop", async () => {
		const me = await arsUser();
		const id = await usdTemplate(me, { nextDueDate: ba("2026-09-01") });
		afterFirstPeriod(me, () =>
			fixtureDb.recurringTemplate.update({
				where: { id },
				data: { amountMode: "ASK" },
			}),
		);
		expect(await sweep(NOV_NOW, [me])).toEqual({
			...NONE,
			posted: 1,
			raced: 1,
		});
		expect(await dueOf(id)).toBe(OCT);
	});

	it("protection turned on between periods: period 1 posts, then it stops without counting a failure", async () => {
		const me = await arsUser();
		const id = await usdTemplate(me, { nextDueDate: ba("2026-09-01") });
		afterFirstPeriod(me, () =>
			adminDb.user.update({
				where: { id: me },
				data: { protectionState: "ON" },
			}),
		);
		expect(await sweep(NOV_NOW, [me])).toEqual({ ...NONE, posted: 1 });
		expect((await booked(me)).map((r) => r.date)).toEqual([SEP]);
		expect(await dueOf(id)).toBe(OCT);
	});

	it("no rate for period 3 of 5: periods 1 and 2 post, nothing after, and the next pass finishes", async () => {
		const me = await arsUser();
		const id = await usdTemplate(me, { nextDueDate: ba("2026-07-01") });
		finder.missing = (currency, date) =>
			currency === "ARS" && date.getTime() === ba("2026-09-01").getTime();
		expect(await sweep(NOV_NOW, [me])).toEqual({
			...NONE,
			posted: 2,
			missingRate: 1,
		});
		expect((await booked(me)).map((r) => r.date)).toEqual([
			"2026-07-01T03:00:00.000Z",
			"2026-08-01T03:00:00.000Z",
		]);
		expect(await dueOf(id)).toBe(SEP);

		finder.missing = undefined;
		expect(await sweep(NOV_NOW, [me])).toEqual({ ...NONE, posted: 3 });
		expect((await booked(me)).map((r) => r.date)).toEqual([
			"2026-07-01T03:00:00.000Z",
			"2026-08-01T03:00:00.000Z",
			SEP,
			OCT,
			"2026-11-01T03:00:00.000Z",
		]);
		expect(await dueOf(id)).toBe(DUE);
	});
});

describe("the pass writes its counts", () => {
	it("to the status row", async () => {
		await setRates([["2026-06-01", "ARS", "blue", "1545"]]);
		const me = await arsUser();
		await usdTemplate(me);
		await usdTemplate(me, { currency: "COP", amount: "9000" });
		await sweep(NOW, [me]);
		const status = await adminDb.systemStatus.findUniqueOrThrow({
			where: { key: AUTO_POST_STATUS_KEY },
		});
		expect(status.value).toEqual({
			lastRun: NOW,
			...NONE,
			posted: 1,
			missingRate: 1,
		});
	});
});
