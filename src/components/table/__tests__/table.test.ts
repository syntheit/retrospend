import { createElement as h } from "react";
import { describe, expect, it } from "vitest";
import type { TransactionVM } from "~/components/rows/types";
import { TransactionTable } from "~/components/table/transaction-table";
import { render } from "~/components/ui/__tests__/render";

const rows: TransactionVM[] = [
	{
		id: "a",
		title: "Azulejos",
		kind: "expense",
		category: { name: "Home", tone: 17 },
		amount: { minor: 2400000, currency: "ARS" },
		reviewed: true,
		date: "2026-10-21",
	},
	{
		id: "b",
		title: "Uber",
		kind: "expense",
		category: { name: "Transport", tone: 5 },
		amount: { minor: 340000, currency: "ARS" },
		reviewed: false,
		date: "2026-10-19",
	},
];
const text = (html: string) =>
	html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("TransactionTable", () => {
	const html = render(
		h(TransactionTable, {
			rows,
			today: "2026-10-21",
			total: {
				figure: "spent",
				count: 2,
				total: { minor: 2740000, currency: "ARS" },
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

	it("totals with the server's figure and says what it sums", () => {
		const t = text(html);
		expect(t).toContain("Your spending 2 expenses");
		expect(html).toContain('data-figure="spent"');
		expect(html).toContain('data-minor="2740000"');
	});

	it("draws the design's table on the shared engine", () => {
		expect(html).toContain('data-slot="transaction-table"');
		expect(html).toContain('data-slot="table"');
		expect(html).toContain("[&amp;_th]:h-9");
	});
});
