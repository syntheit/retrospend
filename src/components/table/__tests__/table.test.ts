import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import type { TransactionVM } from "~/components/rows/types";
import { fitColumns } from "~/components/table/column-fit";
import { TableSkeleton } from "~/components/table/table-skeleton";
import { TransactionTable } from "~/components/table/transaction-table";
import { render } from "~/components/ui/__tests__/render";

const ars = (minor: number) => ({ minor, currency: "ARS" });
const base = {
	kind: "expense",
	category: { name: "Home", tone: 17 },
	reviewed: true,
	date: "2026-10-19",
} as const;
const rows: TransactionVM[] = [
	{
		...base,
		id: "a",
		title: "Azulejos",
		amount: ars(2400000),
		sortKey: 2400000,
		date: "2026-10-21",
	},
	{
		...base,
		id: "b",
		title: "Uber",
		amount: ars(340000),
		sortKey: 340000,
		reviewed: false,
	},
	// USD 300.00 is 30000 minor, less than ARS 3,400 in native minor units, but
	// it is worth ARS 423,600 at home: the server's sort key says so.
	{
		...base,
		id: "c",
		title: "Hotel",
		amount: { minor: 30000, currency: "USD" },
		home: ars(42360000),
		sortKey: 42360000,
	},
	// No rate yet: no sort key, always last.
	{
		...base,
		id: "d",
		title: "Dominio",
		amount: { minor: 1420, currency: "USD" },
		home: null,
		sortKey: null,
	},
];
const text = (html: string) =>
	html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const order = (html: string) =>
	["Azulejos", "Uber", "Hotel", "Dominio"]
		.map((t) => [t, html.indexOf(`>${t}<`)] as const)
		.sort((a, b) => a[1] - b[1])
		.map(([t]) => t);

describe("TransactionTable", () => {
	const html = render(
		h(TransactionTable, {
			rows,
			today: "2026-10-21",
			onOpen: () => undefined,
			total: {
				figure: "spent",
				count: 4,
				total: ars(45100000),
				withoutRate: 1,
			},
		}),
	);

	it("has the Activity columns and a checkbox per row", () => {
		const t = text(html);
		for (const c of ["Title", "Category", "Project", "With", "Date", "Amount"])
			expect(t).toContain(c);
		expect(html).toContain('aria-label="Select all"');
		expect(html).toContain('aria-label="Select Uber"');
	});

	it("labels today and older days, and marks unreviewed rows", () => {
		const t = text(html);
		expect(t).toContain("Today");
		expect(t).toContain("Mon, Oct 19");
		expect(t).toContain("To review");
	});

	it("totals with the server's figure and counts rows without a rate", () => {
		const t = text(html);
		expect(t).toContain("Your spending 4 expenses · 1 without a rate");
		expect(html).toContain('data-figure="spent"');
		expect(html).toContain('data-minor="45100000"');
	});

	it("keyboard: focusable rows, the title is a button, sortable headers say their sort", () => {
		expect(html.match(/<tr[^>]*tabindex="0"/g)).toHaveLength(rows.length);
		expect(html).toMatch(
			/<button[^>]*><span class="truncate">Uber<\/span><\/button>/,
		);
		expect(html).toContain('aria-sort="none"');
		expect(html).toMatch(
			/role="button" tabindex="0"><span class="truncate font-medium">Amount/,
		);
	});

	it("shows no chevron until a column is sorted", () => {
		const head = html.slice(0, html.indexOf("</thead>"));
		expect(head).not.toContain("lucide-chevron");
	});

	it("sorts the amount on the home sort key, rows without a rate last", () => {
		const desc = render(
			h(TransactionTable, { rows, sort: [{ id: "amount", desc: true }] }),
		);
		expect(order(desc)).toEqual(["Hotel", "Azulejos", "Uber", "Dominio"]);
		const asc = render(
			h(TransactionTable, { rows, sort: [{ id: "amount", desc: false }] }),
		);
		expect(order(asc)).toEqual(["Uber", "Azulejos", "Hotel", "Dominio"]);
		expect(desc).toContain('aria-sort="descending"');
		const head = desc.slice(0, desc.indexOf("</thead>"));
		expect(head.match(/lucide-chevron/g)).toHaveLength(1);
	});

	it("draws the design's table on the shared engine", () => {
		expect(html).toContain('data-slot="transaction-table"');
		expect(html).toContain('data-slot="table"');
		expect(html).toContain("[&amp;_th]:h-9");
	});
});

describe("TransactionTable layouts", () => {
	it("layout A: day rows with their total replace the Date column", () => {
		const html = render(
			h(TransactionTable, {
				rows,
				today: "2026-10-21",
				groups: {
					by: "day",
					label: (d: string) => `Day ${d}`,
					total: (d: string) => (d === "2026-10-21" ? "T21" : null),
				},
			}),
		);
		const t = text(html);
		expect(t).not.toContain(" Date ");
		expect(html.match(/data-group="/g)).toHaveLength(2);
		expect(t.indexOf("Day 2026-10-21 T21")).toBeLessThan(t.indexOf("Azulejos"));
		expect(t.indexOf("Day 2026-10-19")).toBeLessThan(t.indexOf("Uber"));
		// Grouped rows keep the server's order: no sortable headers.
		expect(html).not.toContain('aria-sort="none"');
	});

	it("a selection shows the bulk bar with its count; disabled rows keep a box", () => {
		const html = render(
			h(TransactionTable, {
				rows,
				canSelect: (tx: TransactionVM) => tx.id !== "d",
				selection: { selected: new Set(["a", "b"]), onChange: () => undefined },
				bulk: () => "BULK",
			}),
		);
		expect(html).toContain('data-slot="bulk-bar"');
		expect(text(html)).toContain("2 selected BULK Clear");
		expect(html).toMatch(
			/<button[^>]*disabled[^>]*aria-label="Select Dominio"|aria-label="Select Dominio"[^>]*disabled/,
		);
	});

	it("a payment says Payment once: the category column names it, the title only Pending", () => {
		const html = render(
			h(TransactionTable, {
				rows: [
					{
						...base,
						id: "p",
						title: "You paid Lucía",
						kind: "payment",
						category: null,
						pending: true,
						amount: ars(500000),
					},
				],
			}),
		);
		const t = text(html);
		expect(t).not.toContain("Payment · Pending");
		expect(t.match(/Payment/g)).toHaveLength(1);
		expect(t).toContain("Pending");
	});

	it("a project's columns: Paid by, Split, Total and Your share; a solo one only Total", () => {
		const shared = text(
			render(h(TransactionTable, { rows, ledger: "project" })),
		);
		for (const c of ["Paid by", "Split", "Total", "Your share"])
			expect(shared).toContain(c);
		expect(shared).not.toContain("Category");
		const solo = text(
			render(h(TransactionTable, { rows, ledger: "project", solo: true })),
		);
		expect(solo).toContain("Total");
		for (const c of ["Paid by", "Split", "Your share"])
			expect(solo).not.toContain(c);
	});

	it("a person's columns end with Between you: the effect, or why there is none", () => {
		const html = render(
			h(TransactionTable, {
				ledger: "between",
				rows: [
					{ ...rows[0]!, between: { amount: ars(1200000), state: "ok" } },
					{ ...rows[1]!, between: { amount: null, state: "review" } },
				],
			}),
		);
		const t = text(html);
		expect(t).toContain("Between you");
		expect(t).toContain("owes you ARS 12,000");
		expect(t).toContain("Waits for you");
	});
});

describe("fitColumns", () => {
	const optional = [
		{ id: "category", size: 148 },
		{ id: "project", size: 150 },
		{ id: "with", size: 150 },
	];
	// Select 40, amount 140 and the ⋯ column 40 always show, then the Title's
	// 192: 412 before any optional column.
	const fixed = 220;
	const at = (space: number | null) => [...fitColumns(space, fixed, optional)];

	it("shows every column until the width is measured", () => {
		expect(at(null)).toEqual(["category", "project", "with"]);
	});

	it("drops With first, then Project, then Category", () => {
		expect(at(860)).toEqual(["category", "project", "with"]);
		expect(at(859)).toEqual(["category", "project"]);
		expect(at(710)).toEqual(["category", "project"]);
		expect(at(709)).toEqual(["category"]);
		expect(at(560)).toEqual(["category"]);
		expect(at(559)).toEqual([]);
	});

	it("keeps the Title its minimum when nothing else fits", () => {
		expect(at(300)).toEqual([]);
	});
});

describe("TableSkeleton", () => {
	it("is table-shaped: a header band and placeholder rows", () => {
		const html = render(h(TableSkeleton, { rows: 3 }));
		expect(html).toContain('aria-busy="true"');
		expect(html.match(/<tr/g)).toHaveLength(4);
	});
});
