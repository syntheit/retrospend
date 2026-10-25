import { describe, expect, it } from "vitest";
import type {
	CategoryRow,
	MonthBar,
	YtdCategoryRow,
} from "~/server/services/insights/types";
import {
	categoryItems,
	monthFigure,
	monthTotals,
	type RankWords,
	ytdItems,
} from "./insights-vm";

const ars = (minor: number) => ({ minor, currency: "ARS" });
const usd = (minor: number) => ({ minor, currency: "USD" });

const WORDS: RankWords = {
	none: "No category",
	fresh: "new",
	change: (basis) => `${basis / 100}%`,
};
const REFS = new Map([
	["rent", { name: "Rent", icon: null, tone: 3 }],
	["food", { name: "Groceries", icon: null, tone: 5 }],
]);
const hrefOf = (id: string) => `/activity?cat=${id}`;

const row = (
	categoryId: string | null,
	value: number | null,
	changePct: number | null,
): CategoryRow => ({
	categoryId,
	figure: "insights.byCategory",
	value: value === null ? null : ars(value),
	previous: null,
	changePct,
});

describe("categoryItems", () => {
	it("keeps the server's order and tags each row with its scoped figure and link", () => {
		const items = categoryItems(
			[row("rent", 65000000, null), row("food", 25180000, null)],
			REFS,
			{ compare: false, words: WORDS, hrefOf },
		);
		expect(items.map((i) => [i.label, i.figure, i.href, i.note])).toEqual([
			["Rent", "insights.byCategory:rent", "/activity?cat=rent", undefined],
			[
				"Groceries",
				"insights.byCategory:food",
				"/activity?cat=food",
				undefined,
			],
		]);
		expect(items[0]?.category).toEqual(REFS.get("rent"));
	});

	it("with Compare, a change shows in the server's percent and nothing before reads new", () => {
		const items = categoryItems(
			[row("rent", 100, 53), row("food", 50, -13), row(null, 10, null)],
			REFS,
			{ compare: true, words: WORDS, hrefOf },
		);
		expect(items.map((i) => i.note)).toEqual(["53%", "-13%", "new"]);
	});

	it("spending with no category (or a removed one) is a neutral row with no link or figure", () => {
		const [none] = categoryItems([row(null, 900, null)], REFS, {
			compare: false,
			words: WORDS,
			hrefOf,
		});
		expect(none).toMatchObject({ id: "none", label: "No category" });
		expect(none?.href).toBeUndefined();
		expect(none?.figure).toBeUndefined();
		const [gone] = categoryItems([row("deleted", 900, null)], REFS, {
			compare: false,
			words: WORDS,
			hrefOf,
		});
		expect(gone?.label).toBe("No category");
	});

	it("a category with no value (a missing rate) is left out, not shown as zero", () => {
		expect(
			categoryItems([row("rent", null, null)], REFS, {
				compare: true,
				words: WORDS,
				hrefOf,
			}),
		).toEqual([]);
	});
});

const ytd = (
	categoryId: string,
	home: number | null,
	dollars: number | null,
	changePct: number | null,
	usdChangePct: number | null,
): YtdCategoryRow => ({
	categoryId,
	figure: "insights.ytdByCategory",
	usdFigure: "insights.ytdByCategoryUsd",
	value: {
		home: home === null ? null : ars(home),
		usd: dollars === null ? null : usd(dollars),
	},
	lastYear: { home: null, usd: null },
	changePct,
	usdChangePct,
});

describe("ytdItems", () => {
	const rows = [ytd("rent", 900, 10, 98, 5), ytd("food", 500, 40, null, 20)];
	const o = { words: WORDS, hrefOf };

	it("in the home currency: its figure, its change", () => {
		const items = ytdItems(rows, REFS, { ...o, usd: false });
		expect(items.map((i) => [i.id, i.value, i.figure, i.note])).toEqual([
			["rent", ars(900), "insights.ytdByCategory:rent", "98%"],
			["food", ars(500), "insights.ytdByCategory:food", "new"],
		]);
	});

	it("in USD: the USD figure and change, ranked by USD", () => {
		const items = ytdItems(rows, REFS, { ...o, usd: true });
		expect(items.map((i) => [i.id, i.value, i.figure, i.note])).toEqual([
			["food", usd(40), "insights.ytdByCategoryUsd:food", "20%"],
			["rent", usd(10), "insights.ytdByCategoryUsd:rent", "5%"],
		]);
	});

	it("a row with no USD value is left out of the USD list, never shown as zero", () => {
		const items = ytdItems([ytd("rent", 900, null, 98, null)], REFS, {
			...o,
			usd: true,
		});
		expect(items).toEqual([]);
	});
});

describe("months", () => {
	const bar = (month: string, total: number | null): MonthBar => ({
		month,
		span: { from: `${month}-15`, to: `${month}-14` },
		figure: "insights.byMonth",
		total: total === null ? null : ars(total),
	});

	it("bars are named by the fiscal month's label; a missing rate is a gap", () => {
		const bars = [bar("2026-09", 100), bar("2026-10", null)];
		expect(monthTotals(bars)).toEqual([
			{ month: "2026-09-01", total: ars(100) },
			{ month: "2026-10-01", total: null },
		]);
		expect(monthFigure(bars[0] as MonthBar)).toBe("insights.byMonth:2026-09");
	});
});
