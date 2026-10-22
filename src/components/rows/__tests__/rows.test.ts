import { createElement as h, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { AccountRow } from "~/components/rows/account-row";
import { EnvelopeRow } from "~/components/rows/envelope-row";
import { PersonRow } from "~/components/rows/person-row";
import { ProjectRow } from "~/components/rows/project-row";
import { RecurringRow } from "~/components/rows/recurring-row";
import { RowList, type RowVariant } from "~/components/rows/row";
import { TransactionRow } from "~/components/rows/transaction-row";
import type { TransactionVM } from "~/components/rows/types";
import { render } from "~/components/ui/__tests__/render";

const ars = (minor: number) => ({ minor, currency: "ARS" });
const list = (row: ReactNode, variant: RowVariant = "flat") =>
	render(h(RowList, { variant, children: row }));
const text = (html: string) =>
	html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const base: TransactionVM = {
	id: "t1",
	title: "Super Norte",
	kind: "expense",
	category: { name: "Groceries", icon: "ShoppingBasket", tone: 1 },
	amount: ars(6400000),
	reviewed: true,
	date: "2026-10-19",
};

describe("TransactionRow", () => {
	it("shows the amount as sent, the category and the tile in its color", () => {
		const html = list(h(TransactionRow, { tx: base }));
		expect(text(html)).toContain("Super Norte");
		expect(text(html)).toContain("Groceries");
		expect(html).toContain('data-minor="6400000"');
		expect(html).toContain("--c:var(--category-1)");
	});

	it("pairs a foreign amount: original first, home second", () => {
		const html = list(
			h(TransactionRow, {
				tx: {
					...base,
					amount: { minor: 299, currency: "USD" },
					home: ars(421309),
				},
			}),
		);
		const t = text(html);
		expect(t.indexOf("USD 2.99")).toBeLessThan(t.indexOf("ARS 4,213.09"));
	});

	it("says No rate yet when the server has no home amount", () => {
		const html = list(
			h(TransactionRow, {
				tx: { ...base, amount: { minor: 299, currency: "USD" }, home: null },
			}),
		);
		expect(text(html)).toContain("No rate yet");
	});

	it("shows your share under a split and the payer", () => {
		const html = list(
			h(TransactionRow, {
				tx: {
					...base,
					share: ars(3200000),
					people: [
						{ id: "lucia", name: "Lucía Fernández" },
						{ id: "me", name: "Sofía", isSelf: true },
					],
					payerId: "lucia",
					payerName: "Lucía",
				},
			}),
		);
		expect(text(html)).toContain("your share ARS 32,000");
		expect(text(html)).toContain("Lucía paid");
	});

	it("mutes a money move and names its kind; marks unreviewed rows", () => {
		const html = list(
			h(TransactionRow, {
				tx: {
					...base,
					kind: "payment",
					category: null,
					pending: true,
					reviewed: false,
				},
			}),
		);
		expect(text(html)).toContain("Payment · Pending");
		expect(text(html)).toContain("To review");
		expect(html).toContain("text-fg-3");
	});

	it("reads money in as positive with a plus", () => {
		const html = list(h(TransactionRow, { tx: { ...base, kind: "income" } }));
		expect(text(html)).toContain("+ARS 64,000");
		expect(html).toContain("text-positive");
	});
});

describe("RowList", () => {
	it("is a bordered surface group on phone and flat on desktop", () => {
		expect(list(null, "group")).toContain(
			"rounded-panel border border-line bg-surface",
		);
		expect(list(null, "flat")).not.toContain("rounded-panel");
	});
});

describe("entity rows", () => {
	it("PersonRow: balance words carry the sign; Not on Retrospend is a status", () => {
		const html = list(
			h(PersonRow, {
				person: {
					id: "paz",
					name: "Paz Ibarra",
					onRetrospend: false,
					lastShared: "Churrasco, 4 days ago",
					balance: ars(-17228200),
					href: "/people/paz",
				},
			}),
		);
		expect(text(html)).toContain("you owe ARS 172,282");
		expect(text(html)).toContain("Not on Retrospend");
		expect(html).toContain('href="/people/paz"');
	});

	it("ProjectRow: a solo project shows what it spent and its dates", () => {
		const html = list(
			h(ProjectRow, {
				project: {
					id: "p3",
					name: "Renovación cocina",
					href: "/projects/p3",
					solo: true,
					people: [],
					peopleCount: 1,
					start: "2026-08-12",
					end: "2026-10-01",
					spent: ars(229400000),
					budgetUsed: { basis: 5100, over: false },
				},
			}),
		);
		const t = text(html);
		expect(t).toContain("Solo");
		expect(t).toContain("Aug 12 to Oct 1");
		expect(t).toContain("ARS 2,294,000 spent");
		expect(html).toContain('aria-label="Budget used"');
	});

	it("AccountRow: native first, home under it, the month's change", () => {
		const html = list(
			h(AccountRow, {
				account: {
					id: "a7",
					name: "Bitcoin",
					kind: "crypto",
					amount: { minor: 1834217, currency: "BTC" },
					home: ars(173516928),
					updated: "2026-10-12",
					change: -220,
				},
			}),
		);
		const t = text(html);
		expect(t).toContain("BTC 0.01834217");
		expect(t).toContain("Updated Oct 12");
		expect(t).toContain("-2.2% this month");
	});

	it("EnvelopeRow: one Available pill with its word", () => {
		const html = list(
			h(EnvelopeRow, {
				envelope: {
					id: "n2",
					name: "Restaurants",
					category: { name: "Restaurants", tone: 2 },
					available: ars(4840000),
					status: "overspent",
					spent: 10000,
				},
			}),
		);
		expect(text(html)).toContain("ARS 48,400 · Overspent");
		expect(html).toContain("*:bg-attention");
	});

	it("RecurringRow: overdue says since when on desktop and offers Confirm and Skip", () => {
		const html = list(
			h(RecurringRow, {
				item: {
					id: "r2",
					title: "Fibra e internet",
					category: { name: "Internet", tone: 9 },
					frequency: "monthly",
					next: "2026-10-08",
					state: "overdue",
					direction: "out",
					amount: ars(3890000),
				},
				onConfirm: () => undefined,
				onSkip: () => undefined,
			}),
		);
		const t = text(html);
		expect(t).toContain("Monthly");
		expect(t).toContain("Overdue since Oct 8");
		expect(t).toContain("Confirm");
		expect(t).toContain("Skip");
	});
});

describe("narrow rows (390)", () => {
	it("the subline clips and the category gives way before the money does", () => {
		const html = list(
			h(TransactionRow, {
				tx: { ...base, title: "Churrasco de despedida", reviewed: false },
			}),
			"group",
		);
		expect(html).toMatch(/class="[^"]*overflow-hidden[^"]*whitespace-nowrap/);
		expect(html).toMatch(
			/min-w-0 shrink truncate"><span aria-hidden="true">·<\/span><span class="truncate">Groceries/,
		);
	});

	it("money in a row is body size (14px)", () => {
		const html = list(h(TransactionRow, { tx: base }));
		expect(html).toMatch(
			/class="text-body relative z-10 flex flex-col items-end/,
		);
	});

	it("amounts carry their figure id for the audit", () => {
		const html = list(
			h(TransactionRow, { tx: { ...base, figure: "expense.t1.amount" } }),
		);
		expect(html).toContain('data-figure="expense.t1.amount"');
	});
});
