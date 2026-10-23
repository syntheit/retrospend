import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import { GlanceStrip, type GlanceVM } from "~/components/glance/glance-strip";
import { NeedsYouList } from "~/components/needs-you/needs-you-list";
import type { NeedsYouItemVM } from "~/components/needs-you/types";
import { render } from "~/components/ui/__tests__/render";

const ars = (minor: number) => ({ minor, currency: "ARS" });
const text = (html: string) =>
	html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const ITEMS: NeedsYouItemVM[] = [
	{ id: "1", kind: "assign", amount: ars(85000000) },
	{ id: "2", kind: "review", count: 7 },
	{ id: "3", kind: "confirmPayment", person: "Lucía", amount: ars(2000000) },
	{
		id: "4",
		kind: "verify",
		person: "Tomás",
		title: "Remeras",
		amount: { minor: 8500, currency: "USD" },
	},
	{ id: "5", kind: "due", title: "Streamly", amount: ars(1922500) },
	{ id: "6", kind: "overdue", title: "Fibra e internet", amount: ars(3890000) },
	{ id: "7", kind: "overspent", envelope: "Restaurants", amount: ars(4840000) },
];

describe("NeedsYouList", () => {
	it("writes one sentence and one action per kind", () => {
		const t = text(render(h(NeedsYouList, { items: ITEMS })));
		for (const s of [
			"Give ARS 850,000 a job",
			"Review 7 imported",
			"Lucía says they paid you",
			"Tomás added you to Remeras",
			"Streamly is due today",
			"Fibra e internet is overdue",
			"Restaurants is over",
		])
			expect(t).toContain(s);
		for (const a of ["Assign", "Review", "Confirm", "Cover"])
			expect(t).toContain(a);
	});

	it("tints only the overdue icon with attention", () => {
		const html = render(h(NeedsYouList, { items: ITEMS }));
		expect(html.match(/bg-attention-bg/g)).toHaveLength(1);
	});

	it("moves the amount under the sentence in a phone group", () => {
		const html = render(
			h(NeedsYouList, { items: ITEMS.slice(5), variant: "group" }),
		);
		expect(html).toMatch(
			/is overdue<span class="[^"]*\bblock\b[^"]*" data-slot="money"/,
		);
		for (const c of ["rounded-panel", "border-line", "bg-surface"])
			expect(html).toContain(c);
	});

	it("says All clear when nothing waits", () => {
		expect(text(render(h(NeedsYouList, { items: [] })))).toContain("All clear");
	});
});

const GLANCE: GlanceVM = {
	month: "2026-10-01",
	spent: ars(270660200),
	line: { kind: "perDay", perDay: ars(537800), daysLeft: 11 },
	fasterThanPlanned: true,
	pace: {
		currency: "ARS",
		days: 31,
		current: [100, 200],
		previous: [50, 150, 300],
	},
	rows: [
		{ id: "owedToYou", amount: ars(166364300), href: "/people" },
		{ id: "youOwe", amount: ars(22977000), href: "/people" },
	],
};

describe("GlanceStrip", () => {
	it("leads with the month's spending and the server's line", () => {
		const t = text(render(h(GlanceStrip, { glance: GLANCE })));
		expect(t).toContain("Spent in October");
		expect(t).toContain("ARS 2,706,602");
		expect(t).toContain("ARS 5,378 a day left for 11 days");
		expect(t).toContain("Spending faster than planned");
	});

	it("keeps Owed to you and You owe as two rows (D1)", () => {
		const t = text(render(h(GlanceStrip, { glance: GLANCE })));
		expect(t).toContain("Owed to you ARS 1,663,643");
		expect(t).toContain("You owe ARS 229,770");
	});

	it("a missing rate says so in the hero and names the currencies (R14)", () => {
		const html = render(
			h(GlanceStrip, {
				glance: {
					...GLANCE,
					spent: null,
					spentFigure: "glance.spent",
					line: { kind: "unavailable", currencies: ["BRL", "CLP"] },
					fasterThanPlanned: false,
				},
			}),
		);
		const t = text(html);
		expect(t).toContain("No rate yet");
		expect(t).toContain("Budget not available: no rate for BRL, CLP yet");
		expect(html).toMatch(/data-figure="glance.spent"(?![^>]*data-minor)/);
	});

	it("a row with no rate stays and says so; faces sit beside the amount", () => {
		const html = render(
			h(GlanceStrip, {
				glance: {
					...GLANCE,
					line: { kind: "unavailable", currencies: [] },
					rows: [
						{
							id: "owedToYou",
							amount: null,
							href: "/people",
							figure: "owed.owedToYou",
						},
						{
							id: "youOwe",
							amount: ars(22977000),
							href: "/people",
							faces: [{ id: "m", name: "Martín Acosta" }],
						},
					],
				},
			}),
		);
		const t = text(html);
		expect(t).toContain("Owed to you No rate yet");
		expect(t).toContain("Budget not available: a rate is missing");
		expect(html).toContain('aria-label="Martín Acosta"');
	});

	it("rowsBeside puts the rows in a column beside the chart from 1024px", () => {
		const beside = render(h(GlanceStrip, { glance: GLANCE, rowsBeside: true }));
		expect(beside).toContain("@5xl:grid-cols-5");
		expect(beside).toContain("@5xl:col-span-2");
		expect(render(h(GlanceStrip, { glance: GLANCE }))).not.toContain(
			"@5xl:grid-cols-5",
		);
	});

	it("variant B is the compact strip without the pace line", () => {
		const html = render(h(GlanceStrip, { glance: GLANCE, variant: "B" }));
		expect(html).not.toContain('role="img"');
		expect(html).toContain("grid-flow-col");
	});
});

describe("narrow layouts", () => {
	it("GlanceStrip lays out by its own width, B is 2 by 2 when narrow", () => {
		const a = render(h(GlanceStrip, { glance: GLANCE }));
		expect(a).toContain("@container");
		expect(a).toContain("@xl:grid-cols-[1fr_minmax(180px,360px)]");
		const b = render(h(GlanceStrip, { glance: GLANCE, variant: "B" }));
		expect(b).toContain("grid-cols-2");
		expect(b).toContain("@xl:grid-flow-col");
	});

	it("the assign sentence carries the amount as Money; the figure sits on the amount column", () => {
		const html = render(
			h(NeedsYouList, {
				items: [
					{
						id: "a",
						kind: "assign",
						amount: ars(85000000),
						figure: "budget.notPlannedYet",
					},
				],
			}),
		);
		expect(text(html)).toContain("Give ARS 850,000 a job");
		expect(html.match(/data-figure="budget.notPlannedYet"/g)).toHaveLength(1);
	});
});

describe("NeedsYouList: setup, rejected and budget kinds", () => {
	const MORE: NeedsYouItemVM[] = [
		{ id: "s1", kind: "firstExpense", context: "Takes about ten seconds" },
		{ id: "s2", kind: "homeCurrency" },
		{ id: "s3", kind: "verifyEmail", context: "sofia@example.com" },
		{ id: "s4", kind: "importStatement" },
		{
			id: "r1",
			kind: "rejected",
			person: "Martín",
			title: "Pizza night",
			amount: ars(1800000),
		},
		{ id: "b1", kind: "overspentMany", count: 2, amount: ars(8040000) },
		{ id: "b2", kind: "overAssigned", amount: ars(1200000) },
		{
			id: "b3",
			kind: "billDue",
			title: "Rent",
			count: 1,
			amount: ars(65000000),
		},
		{ id: "b4", kind: "billDue", title: null, count: 3, amount: ars(9000000) },
		{ id: "b5", kind: "missingRate", currencies: ["BRL", "CLP"] },
		{ id: "b6", kind: "startingMoney" },
	];

	it("writes one sentence and one action per new kind", () => {
		const t = text(render(h(NeedsYouList, { items: MORE })));
		for (const s of [
			"Add your first expense",
			"Set your home currency",
			"Verify your email",
			"Import a statement",
			"Martín rejected Pizza night",
			"2 envelopes are over",
			"You planned ARS 12,000 more than you have",
			"Rent is due soon",
			"3 bills are due soon",
			"No rate for BRL, CLP yet",
			"Confirm your starting money",
		])
			expect(t).toContain(s);
		for (const a of [
			"Add expense",
			"Choose",
			"Resend",
			"Import",
			"Edit",
			"Take back",
			"Fund",
			"Set rate",
		])
			expect(t).toContain(a);
	});

	it("the server's action id picks the button word; an unknown id keeps the kind's", () => {
		const t = text(
			render(
				h(NeedsYouList, {
					items: [
						{ ...MORE[4], id: "x1", action: "correct" },
						{ ...MORE[4], id: "x2", action: "review" },
					] as NeedsYouItemVM[],
				}),
			),
		);
		expect(t).toContain("Edit");
		expect(t).toContain("Review");
	});

	it("puts the context line under the sentence", () => {
		const t = text(render(h(NeedsYouList, { items: MORE.slice(0, 1) })));
		expect(t).toContain("Add your first expense Takes about ten seconds");
	});

	it("a phone group joins the amount and the context in one line", () => {
		const html = render(
			h(NeedsYouList, {
				items: [
					{
						id: "o",
						kind: "overdue",
						title: "Fibra",
						amount: ars(3890000),
						context: "Was due Oct 8",
						figure: "x",
					},
				],
				variant: "group",
			}),
		);
		expect(text(html)).toContain("Fibra is overdue ARS 38,900 · Was due Oct 8");
		expect(html.match(/data-figure="x"/g)).toHaveLength(1);
	});
});
