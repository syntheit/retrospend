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

	it("keeps only the faces on a phone row, so the category keeps its room", () => {
		const html = list(
			h(TransactionRow, {
				tx: {
					...base,
					people: [
						{ id: "lucia", name: "Lucía Fernández" },
						{ id: "me", name: "Sofía", isSelf: true },
					],
					payerId: "lucia",
					payerName: "Lucía",
				},
			}),
			"group",
		);
		expect(html).toMatch(/class="text-fg-2 hidden">Lucía paid/);
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

	it("ProjectRow columns: total with your share, budget left, your balance", () => {
		const html = list(
			h(ProjectRow, {
				project: {
					id: "p2",
					name: "Depto Palermo",
					href: "/projects/p2",
					solo: false,
					people: [{ id: "martin", name: "Martín Acosta" }],
					peopleCount: 2,
					balance: ars(-4110000),
					budgetUsed: { basis: 10000, over: true },
					columns: {
						total: ars(61500000),
						share: ars(30750000),
						budgetLeft: ars(-1500000),
					},
				},
			}),
		);
		const t = text(html);
		expect(t).toContain("ARS 615,000 your share ARS 307,500");
		expect(t).toContain("ARS 15,000 over");
		expect(t).toContain("you owe ARS 41,100");
		expect(html).toContain("*:bg-attention");
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

	it("AccountRow on Wealth: the code, then how it counts, then the day", () => {
		const account = {
			id: "a2",
			name: "Caja USD",
			kind: "cash" as const,
			amount: { minor: 120000, currency: "USD" },
			home: ars(176160000),
			updated: "2026-10-18",
		};
		const valued = text(
			list(
				h(AccountRow, {
					account: { ...account, detail: { valuedAt: "Blue" } },
				}),
			),
		);
		expect(valued).toContain("USD · Valued at Blue · Updated Oct 18");
		const card = text(
			list(
				h(AccountRow, {
					account: {
						...account,
						kind: "liability",
						detail: { apr: 11800, valuedAt: "Blue" },
					},
				}),
			),
		);
		expect(card).toContain("APR 118");
		expect(card).not.toContain("Valued at");
		const norate = list(
			h(AccountRow, {
				account: {
					...account,
					amount: { minor: 5000000, currency: "CLP" },
					home: null,
					detail: { noRate: true },
				},
			}),
		);
		expect(text(norate)).toContain("No CLP rate. Left out of net worth.");
		expect(norate).toContain("text-attention-text");
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
		// Monthly is the usual case, so the row leaves the word out (recurring.html).
		expect(t).not.toContain("Monthly");
		expect(t).toContain("Overdue since Oct 8");
		expect(t).toContain("Confirm");
		expect(t).toContain("Skip");
	});

	it("RecurringRow: every 2 weeks, the auto-pay line, and a paused template", () => {
		const item = {
			id: "r9",
			title: "Limpieza",
			category: { name: "Home", tone: 4 },
			frequency: "biweekly" as const,
			next: "2026-10-30",
			state: "upcoming" as const,
			direction: "out" as const,
			amount: ars(2500000),
			autoPay: true,
		};
		const t = text(list(h(RecurringRow, { item }), "group"));
		expect(t).toContain("Next Oct 30");
		expect(t).toContain("Every 2 weeks");
		expect(t).toContain("Auto-pay on");
		const paused = list(
			h(RecurringRow, {
				item: { ...item, paused: true, state: "due" },
				onConfirm: () => undefined,
			}),
		);
		expect(text(paused)).toContain("Paused");
		expect(text(paused)).not.toContain("Confirm");
	});

	it("PersonRow: a converted net reads ≈ and lists its parts as held", () => {
		const html = list(
			h(PersonRow, {
				person: {
					id: "lu",
					name: "Lucía Fernández",
					onRetrospend: true,
					lastShared: "Asado",
					when: "3 days ago",
					balance: ars(130300000),
					approx: true,
					parts: [ars(80235200), { minor: 40250, currency: "BRL" }],
					unseen: 2,
					href: "/people/lu",
				},
				words: false,
			}),
		);
		const t = text(html);
		expect(t).toContain("≈ ARS 1,303,000");
		expect(t).not.toContain("owes you");
		expect(t).toContain("ARS 802,352 · BRL 402.50");
		expect(t).toContain("2 new");
		expect(html).toContain('data-slot="unseen-dot"');
	});

	it("PersonRow: a pending payment takes the balance's place", () => {
		const t = text(
			list(
				h(PersonRow, {
					person: {
						id: "ju",
						name: "Juan",
						onRetrospend: true,
						lastShared: "",
						balance: ars(0),
						pending: { direction: "out", amount: ars(3620000) },
						href: "/people/ju",
					},
				}),
			),
		);
		expect(t).toContain("Pending you paid ARS 36,200");
		expect(t).not.toContain("Settled");
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

describe("RowSub", () => {
	it("keeps Not on Retrospend whole at 390: the last thing shared gives way", () => {
		const html = list(
			h(PersonRow, {
				person: {
					id: "p",
					name: "Paz Ibarra",
					onRetrospend: false,
					lastShared: "Churrasco de despedida en la quinta",
					when: "3 days ago",
					balance: ars(94693469),
					href: "/people/guest/p",
				},
			}),
			"group",
		);
		expect(html).toMatch(
			/class="flex items-center gap-2 shrink-0"><span class="[^"]*" data-status="notOnRetrospend"/,
		);
		expect(html).toMatch(/shrink truncate"><span class="truncate">Churrasco/);
	});

	it("leaves out an empty shrinkable part, so no separator leads the line", () => {
		const html = list(
			h(PersonRow, {
				person: {
					id: "p",
					name: "Paz Ibarra",
					onRetrospend: false,
					lastShared: "",
					balance: ars(94693469),
					href: "/people/guest/p",
				},
			}),
		);
		const sub = html.match(/text-meta mt-px[^"]*">(.*?)<\/div>/)?.[1] ?? "";
		expect(sub.match(/<span class="flex items-center gap-2/g)).toHaveLength(1);
	});
});
