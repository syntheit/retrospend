import { NextIntlClientProvider } from "next-intl";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DataTable } from "~/components/data-table";
import type { DataTableColumnDef } from "~/components/data-table-features";

interface Item {
	id: string;
	name: string;
	amount: number;
	date: Date;
	subRows?: Item[];
}

const items: Item[] = Array.from({ length: 25 }, (_, i) => ({
	id: `id-${i}`,
	name: `item ${String(i).padStart(2, "0")}`,
	amount: (i * 7) % 25,
	date: new Date(Date.UTC(2026, 0, 1 + ((i * 11) % 25))),
}));

const columns: DataTableColumnDef<Item>[] = [
	{
		accessorKey: "name",
		header: "Name",
		cell: ({ row }) => `name:${row.original.name}`,
	},
	{
		accessorKey: "amount",
		header: "Amount",
		cell: ({ getValue }) => `amount:${getValue() as number}`,
	},
	{
		accessorKey: "date",
		header: "Date",
		sortFn: "datetime",
		cell: ({ row }) => `date:${row.original.date.toISOString().slice(0, 10)}`,
	},
];

const messages = {
	ui: { rowsPerPage: "Rows per page", pageOfTotal: "Page {page} of {total}" },
};

function render(props: Partial<Parameters<typeof DataTable<Item>>[0]>) {
	const table = createElement(DataTable<Item>, {
		data: items,
		columns,
		searchable: false,
		...props,
	});
	return renderToStaticMarkup(
		createElement(NextIntlClientProvider, {
			locale: "en",
			messages,
			children: table as ReactNode,
		}),
	);
}

function names(html: string) {
	return [...html.matchAll(/name:(item \d+)/g)].map((m) => m[1]);
}

function values(html: string, key: "amount" | "date") {
	return [...html.matchAll(new RegExp(`${key}:([\\d-]+)`, "g"))].map(
		(m) => m[1],
	);
}

describe("DataTable (TanStack Table v9)", () => {
	it("renders every row when pagination is off", () => {
		const html = render({});
		expect(names(html)).toHaveLength(25);
		expect(names(html)[0]).toBe("item 00");
	});

	it("applies initial sorting", () => {
		const html = render({ initialSorting: [{ id: "amount", desc: true }] });
		const amounts = values(html, "amount").map(Number);
		expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
		expect(amounts[0]).toBe(24);
	});

	it("resolves the registered datetime sort by name", () => {
		const html = render({ initialSorting: [{ id: "date", desc: false }] });
		const dates = values(html, "date");
		expect(dates).toEqual([...dates].sort());
		expect(dates[0]).toBe("2026-01-01");
	});

	it("filters rows with the global search value", () => {
		const html = render({ searchValue: "item 1", onSearchChange: () => {} });
		expect(names(html)).toEqual(
			Array.from({ length: 10 }, (_, i) => `item 1${i}`),
		);
	});

	it("hides columns through column visibility", () => {
		const html = render({ columnVisibility: { amount: false } });
		expect(html).not.toContain(">Amount<");
		expect(html).not.toContain("amount:");
		expect(html).toContain(">Name<");
	});

	it("paginates with the default page size and reports the page count", () => {
		const html = render({ pagination: true });
		expect(names(html)).toHaveLength(20);
		expect(html).toContain("Page 1 of 2");
	});

	it("honours a custom default page size", () => {
		const html = render({ pagination: { defaultPageSize: 10 } });
		expect(names(html)).toHaveLength(10);
		expect(html).toContain("Page 1 of 3");
	});

	it("shows only parent rows until sub-rows are expanded", () => {
		const parent: Item = {
			id: "parent",
			name: "item 99",
			amount: 1,
			date: new Date(Date.UTC(2026, 0, 1)),
			subRows: [items[0]!, items[1]!],
		};
		const html = render({
			data: [parent],
			getSubRows: (row) => row.subRows,
		});
		expect(names(html)).toEqual(["item 99"]);
	});

	it("renders the empty state when nothing matches", () => {
		const html = render({
			searchValue: "nothing matches",
			onSearchChange: () => {},
			emptyState: "nothing-here",
		});
		expect(names(html)).toHaveLength(0);
		expect(html).toContain("nothing-here");
	});
});
