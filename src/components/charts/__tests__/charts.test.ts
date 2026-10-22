import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import { AllocationBar } from "~/components/charts/allocation-bar";
import { BalanceBar } from "~/components/charts/balance-bar";
import { MonthlyBars } from "~/components/charts/monthly-bars";
import { NetWorthArea } from "~/components/charts/net-worth-area";
import { PaceLine } from "~/components/charts/pace-line";
import { RankedBars } from "~/components/charts/ranked-bars";
import {
	barShare,
	COLOR,
	edgeTicks,
	niceMax,
	SERIES,
	seriesColor,
} from "~/components/charts/spec";
import { render as renderRaw } from "~/components/ui/__tests__/render";

const ars = (minor: number) => ({ minor, currency: "ARS" });
/** The formatter keeps the code and the number together with a no-break space. */
const render = (node: Parameters<typeof renderRaw>[0]) =>
	renderRaw(node).replace(/\u00a0/g, " ");

describe("chart spec", () => {
	it("colors are token references only", () => {
		for (const c of [...Object.values(COLOR), ...SERIES])
			expect(c).toMatch(
				/^(var\(--[\w-]+\)|color-mix\(in oklab, var\(--[\w-]+\) \d+%, (var\(--[\w-]+\)|transparent)\))$/,
			);
	});

	it("series go in order and wrap after 8; series-1 is the accent slot", () => {
		expect(seriesColor(1)).toBe("var(--series-1)");
		expect(seriesColor(8)).toBe("var(--series-8)");
		expect(seriesColor(9)).toBe("var(--series-1)");
	});

	it("rounds an axis top to 1, 2, 2.5, 5 or 10 times a power of ten", () => {
		expect(niceMax(382000000)).toBe(500000000);
		expect(niceMax(210)).toBe(250);
		expect(niceMax(100)).toBe(100);
		expect(niceMax(0)).toBe(1);
	});

	it("scales ranked bars to the longest, keeping a sliver for small ones", () => {
		expect(barShare(50, 100)).toBe(50);
		expect(barShare(0.1, 100)).toBe(1);
		expect(barShare(0, 100)).toBe(0);
	});

	it("labels first, middle and last of a time axis", () => {
		expect(edgeTicks([1, 2, 3, 4, 5, 6])).toEqual([1, 4, 6]);
		expect(edgeTicks([1, 2])).toEqual([1, 2]);
	});
});

describe("chart summaries (accessible names)", () => {
	it("pace line says where today stands against last month", () => {
		const html = render(
			h(PaceLine, {
				pace: {
					currency: "ARS",
					days: 31,
					current: [100000, 250000],
					previous: [50000, 200000, 300000],
				},
				currentLabel: "October",
				previousLabel: "Last month",
			}),
		);
		expect(html).toContain(
			'aria-label="Day 2: ARS 2,500 spent so far, ARS 2,000 by this day last month"',
		);
	});

	it("monthly bars name the highlighted month", () => {
		const html = render(
			h(MonthlyBars, {
				currency: "ARS",
				months: [
					{ month: "2026-09-01", total: ars(382000000) },
					{ month: "2026-10-01", total: ars(270660200) },
				],
			}),
		);
		expect(html).toContain("Spending by month. October: ARS 2,706,602");
	});

	it("area names its start and end", () => {
		const html = render(
			h(NetWorthArea, {
				currency: "ARS",
				points: [
					{ date: "2026-05-28", value: ars(9840000000) },
					{ date: "2026-10-21", value: ars(13532548300) },
				],
			}),
		);
		expect(html).toContain(
			"Net worth went from ARS 98,400,000 on May to ARS 135,325,483 on Oct",
		);
	});

	it("ranked bars list the items with their amounts", () => {
		const html = render(
			h(RankedBars, {
				items: [
					{
						id: "g",
						label: "Groceries",
						value: ars(46320000),
						category: { name: "Groceries", tone: 1 },
					},
					{ id: "r", label: "Rent", value: ars(32500000) },
				],
			}),
		);
		expect(html).toContain(
			"Largest first: Groceries ARS 463,200, Rent ARS 325,000",
		);
		expect(html).toContain("var(--category-1)");
		expect(html).toContain("var(--ds-accent)");
	});

	it("allocation shows the server's shares, not recomputed ones", () => {
		const html = render(
			h(AllocationBar, {
				items: [
					{ id: "p", label: "Property", value: ars(1), share: 8342, series: 1 },
					{ id: "c", label: "Cash", value: ars(1), share: 935, series: 2 },
				],
			}),
		);
		expect(html).toContain("Split: Property 83%, Cash 9%");
		expect(html).toContain("width:83.42%");
	});

	it("balance bar keeps owed and owe as two figures", () => {
		const html = render(
			h(BalanceBar, {
				owedToYou: ars(152039300),
				youOwe: ars(19797000),
				segments: [
					{
						person: { id: "p", name: "Paz Ibarra" },
						direction: "owed",
						share: 8000,
						amount: ars(1),
					},
					{
						person: { id: "m", name: "Martín Acosta" },
						direction: "owe",
						share: 2000,
						amount: ars(1),
					},
				],
			}),
		);
		expect(html).toContain("Owed to you ARS 1,520,393. You owe ARS 197,970");
		expect(html).toContain("url(#");
	});
});
