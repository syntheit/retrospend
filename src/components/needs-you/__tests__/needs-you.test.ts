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
		expect(html).toMatch(/is overdue<span class="[^"]*\bblock\b[^"]*" data-slot="money"/);
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

	it("variant B is the compact strip without the pace line", () => {
		const html = render(h(GlanceStrip, { glance: GLANCE, variant: "B" }));
		expect(html).not.toContain('role="img"');
		expect(html).toContain("grid-flow-col");
	});
});
