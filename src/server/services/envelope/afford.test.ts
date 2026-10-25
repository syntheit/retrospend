/**
 * "Can I afford it?" (SYNTHESIS-r6 §4, the kit's BudgetPlan.afford). Expected
 * values are the ones the research doc works out by hand (ARS, whole units):
 *
 * Flex, Left to spend 59,161 with 11 days left, a 20,000 item: 39,161 left,
 * 39,161 / 11 = 3,560.09 -> about 3,560 a day. If you usually spend 8,000 a
 * day that is under half (2 x 3,560 = 7,120 < 8,000): tight.
 * A 95,000 jacket: 35,839 over. With 850,000 not planned yet that covers it
 * (add 35,839 to Spending); with nothing not planned, plan it for next month.
 * Every dollar, Everything else holds 8,499, the same jacket needs 86,501
 * more: move it from another envelope.
 * Weekly, 32,000 left this week with 3 days left, a 10,000 item: 22,000 left,
 * 7,333 a day (22,000 / 3 = 7,333.33). A 40,000 item does not fit the week
 * but fits the month (Left to spend 59,161): it takes next week's money.
 */
import { describe, expect, it } from "vitest";
import { afford } from "./afford";

const base = {
	month: 202610,
	nextMonth: 202611,
	leftToSpend: { left: 59_161, daysLeft: 11, notPlanned: 850_000 },
	week: null,
	envelope: null,
	usualPerDay: null,
};

describe("afford, Left to spend styles", () => {
	it("fits: 39,161 left, about 3,560 a day for 11 days", () => {
		expect(afford({ ...base, style: "FLEX", amount: 20_000 })).toMatchObject({
			scope: "SPENDING",
			state: "FITS",
			left: 59_161,
			after: 39_161,
			short: 0,
			perDay: 3_560,
			daysLeft: 11,
			action: null,
		});
	});

	it("fits but tight when a day would fall under half your usual day", () => {
		expect(
			afford({ ...base, style: "FLEX", amount: 20_000, usualPerDay: 8_000 }),
		).toMatchObject({ state: "FITS_TIGHT", perDay: 3_560 });
		// 2 x 3,560 = 7,120 is not under 7,120: not tight.
		expect(
			afford({ ...base, style: "FLEX", amount: 20_000, usualPerDay: 7_120 }),
		).toMatchObject({ state: "FITS" });
	});

	it("does not fit, Not planned yet covers it: add 35,839 to Spending", () => {
		expect(afford({ ...base, style: "FLEX", amount: 95_000 })).toMatchObject({
			state: "SHORT_POOL_COVERS",
			after: -35_839,
			short: 35_839,
			perDay: 0,
			action: { kind: "ADD_TO_SPENDING", amountMinor: 35_839 },
		});
	});

	it("does not fit and nothing covers it: plan it for next month", () => {
		const r = afford({
			...base,
			style: "SAVE_FIRST",
			amount: 95_000,
			leftToSpend: { left: 59_161, daysLeft: 11, notPlanned: 35_838 },
		});
		expect(r).toMatchObject({
			state: "SHORT_NOTHING_LEFT",
			short: 35_839,
			action: { kind: "PLAN_NEXT_MONTH", month: 202611 },
		});
	});

	it("on the last day the whole remainder is the day", () => {
		const r = afford({
			...base,
			style: "FLEX",
			amount: 1_000,
			leftToSpend: { left: 5_000, daysLeft: 0, notPlanned: 0 },
		});
		expect(r).toMatchObject({ state: "FITS", after: 4_000, perDay: 4_000 });
	});

	it("an overspent month never fits", () => {
		const r = afford({
			...base,
			style: "FLEX",
			amount: 1_000,
			leftToSpend: { left: -500, daysLeft: 5, notPlanned: 0 },
		});
		expect(r).toMatchObject({ state: "SHORT_NOTHING_LEFT", short: 1_500 });
	});
});

describe("afford, envelope styles", () => {
	const env = (left: number, hasLimit = true) => ({
		id: "else",
		left,
		hasLimit,
		spent: 12_000,
	});

	it("Every dollar: short by 86,501, move it from another envelope", () => {
		expect(
			afford({
				...base,
				style: "EVERY_DOLLAR",
				amount: 95_000,
				envelope: env(8_499),
			}),
		).toMatchObject({
			scope: "ENVELOPE",
			state: "SHORT_MOVE",
			envelopeId: "else",
			left: 8_499,
			short: 86_501,
			action: {
				kind: "MOVE_MONEY",
				envelopeId: "else",
				amountMinor: 86_501,
			},
		});
	});

	it("an envelope that holds enough fits", () => {
		expect(
			afford({
				...base,
				style: "EVERY_DOLLAR",
				amount: 5_000,
				envelope: env(8_499),
			}),
		).toMatchObject({ state: "FITS", after: 3_499, short: 0 });
	});

	it("an overspent envelope needs the whole amount plus nothing negative", () => {
		expect(
			afford({
				...base,
				style: "LIMITS",
				amount: 1_000,
				envelope: env(-300),
			}),
		).toMatchObject({ state: "SHORT_MOVE", short: 1_000 });
	});

	it("Limits, no limit on it: says what it spent this month", () => {
		expect(
			afford({
				...base,
				style: "LIMITS",
				amount: 5_000,
				envelope: env(0, false),
			}),
		).toMatchObject({ state: "NO_LIMIT", spent: 12_000, action: null });
	});
});

describe("afford, Weekly", () => {
	const week = { left: 32_000, daysLeftInWeek: 3 };

	it("fits this week: 22,000 left, about 7,333 a day until the week resets", () => {
		expect(
			afford({ ...base, style: "WEEKLY", amount: 10_000, week }),
		).toMatchObject({
			scope: "WEEK",
			state: "WEEK_FITS",
			left: 32_000,
			after: 22_000,
			perDay: 7_333,
			daysLeft: 3,
		});
	});

	it("does not fit this week but fits the month: takes next week's money", () => {
		expect(
			afford({ ...base, style: "WEEKLY", amount: 40_000, week }),
		).toMatchObject({
			scope: "WEEK",
			state: "WEEK_NEXT_WEEK",
			after: 19_161,
		});
	});

	it("does not fit the month either: the Left to spend answer", () => {
		expect(
			afford({ ...base, style: "WEEKLY", amount: 95_000, week }),
		).toMatchObject({ scope: "SPENDING", state: "SHORT_POOL_COVERS" });
	});
});
