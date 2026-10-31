import { describe, expect, it } from "vitest";
import type { GetMonthOutput } from "~/lib/schemas/envelope";
import {
	insightsOf,
	previousMonth,
	spendingOf,
	trendMonths,
} from "./insights";

const usd = (minor: number) => ({ minor, currency: "USD" });

function envelope(
	id: string,
	held: number,
	spent: number,
	savings = false,
): GetMonthOutput["groups"][number]["envelopes"][number] {
	return {
		id,
		name: id,
		carryIn: usd(0),
		assigned: usd(held),
		spent: usd(spent),
		left: usd(held - spent),
		spentBasis: savings
			? null
			: held <= 0
				? spent > 0
					? 10_000
					: 0
				: Math.min(10_000, Math.round((spent * 10_000) / held)),
	} as never;
}

function month(
	key: number,
	envelopes: ReturnType<typeof envelope>[],
	incomplete = false,
): GetMonthOutput {
	return {
		book: { currency: "USD", startMonth: 202601 },
		month: { key },
		groups: [{ envelopes }],
		incomplete,
	} as never;
}

describe("spendingOf", () => {
	it("counts what envelopes that spend planned and spent, and leaves savings goals out", () => {
		const m = month(202610, [
			envelope("rent", 50_000, 50_000),
			envelope("food", 20_000, 26_000),
			envelope("goal", 10_000, 0, true),
		]);
		const { planned, spent } = spendingOf(m);
		expect(planned).toBe(70_000);
		expect(spent).toBe(76_000);
	});
});

describe("insightsOf", () => {
	const m = month(202610, [
		envelope("rent", 50_000, 50_000),
		envelope("food", 20_000, 26_000),
		envelope("fun", 10_000, 17_000),
		envelope("bus", 8_000, 1_000),
		envelope("gym", 5_000, 0),
		envelope("goal", 10_000, 0, true),
	]);

	it("totals against the plan and says when it went over", () => {
		const i = insightsOf(m, []);
		expect(i.planned).toEqual(usd(93_000));
		expect(i.spent).toEqual(usd(94_000));
		expect(i.over).toBe(true);
		expect(i.basis).toBe(10_000);
	});

	it("lists the envelopes furthest over and with the most room, three each at most", () => {
		const i = insightsOf(m, []);
		expect(i.mostOver.map((e) => [e.id, e.over.minor])).toEqual([
			["fun", 7_000],
			["food", 6_000],
		]);
		expect(i.mostRoom.map((e) => [e.id, e.left.minor])).toEqual([
			["bus", 7_000],
			["gym", 5_000],
		]);
	});

	it("trend: the earlier months then this one, and none without a second month", () => {
		expect(insightsOf(m, []).trend).toEqual([]);
		const before = month(202609, [envelope("rent", 50_000, 40_000)]);
		const i = insightsOf(m, [before]);
		expect(i.trend).toEqual([
			{ month: 202609, spent: usd(40_000) },
			{ month: 202610, spent: usd(94_000) },
		]);
	});

	it("nothing planned gives no share, and nothing over gives empty lists", () => {
		const empty = insightsOf(month(202610, [envelope("a", 0, 0)]), []);
		expect(empty.basis).toBeNull();
		expect(empty.over).toBe(false);
		expect(empty.mostOver).toEqual([]);
	});
});

describe("trendMonths", () => {
	it("looks back six months, across a year, and never before the book started", () => {
		expect(trendMonths(202603, 202501)).toEqual([
			202510, 202511, 202512, 202601, 202602, 202603,
		]);
		expect(trendMonths(202603, 202602)).toEqual([202602, 202603]);
		expect(trendMonths(202610, 202610)).toEqual([202610]);
	});

	it("previousMonth wraps January", () => {
		expect(previousMonth(202601)).toBe(202512);
		expect(previousMonth(202610)).toBe(202609);
	});
});
