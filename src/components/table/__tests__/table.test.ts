import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import type { TransactionVM } from "~/components/rows/types";
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

describe("TableSkeleton", () => {
	it("is table-shaped: a header band and placeholder rows", () => {
		const html = render(h(TableSkeleton, { rows: 3 }));
		expect(html).toContain('aria-busy="true"');
		expect(html.match(/<tr/g)).toHaveLength(4);
	});
});
