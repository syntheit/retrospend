/**
 * Pure figures of the project pages, in integer minor units. No I/O:
 * the read services load the rows and pass them in. Currencies are never
 * converted or netted against each other.
 */
import type { Money } from "~/server/figures/registry";
import { ratioBp, sumMinor, toMinor } from "~/server/services/envelope/units";
import { toPaymentCurrency } from "~/server/services/payments/allocate";
import type { Quote } from "~/server/services/payments/types";

type Amount = number | { toString(): string };

export interface ProjectBudget {
	amount: Money;
	/** What the project spent in the budget's currency (its `project.total` line). */
	spent: Money;
	/** Budget minus spent; negative when over. */
	left: Money;
	/** Spent over budget in hundredths of a percent, capped at 10000 for the bar. */
	used: number;
	over: boolean;
}

/**
 * The budget line of a project, or null without one. It compares the
 * budget only with spending in the budget's own currency: other currencies
 * are left out, never converted.
 */
export function budgetOf(
	project: {
		budgetAmount: Amount | null;
		budgetCurrency: string | null;
		primaryCurrency: string;
	},
	total: readonly Money[],
): ProjectBudget | null {
	if (project.budgetAmount == null) return null;
	const currency = project.budgetCurrency ?? project.primaryCurrency;
	const amount = toMinor(project.budgetAmount.toString(), currency);
	if (amount <= 0) return null;
	const spent = total.find((m) => m.currency === currency)?.minor ?? 0;
	const left = amount - spent;
	return {
		amount: { minor: amount, currency },
		spent: { minor: spent, currency },
		left: { minor: left, currency },
		used: Math.min(10_000, ratioBp(spent, amount) ?? 0),
		over: left < 0,
	};
}

export interface CategoryLine {
	/** The category id, or null for expenses without one. */
	id: string | null;
	name: string | null;
	icon: string | null;
	color: string | null;
	/** Every expense in this category, per currency. */
	group: Money[];
	/** Your shares of them, per currency. */
	mine: Money[];
}

export interface CategoryInput {
	currency: string;
	amount: Amount;
	category: {
		id: string;
		name: string;
		icon: string | null;
		color: string;
	} | null;
	/** Your share of this expense, or null when you are not in it. */
	myShare: Amount | null;
}

const add = (into: Map<string, number[]>, currency: string, minor: number) => {
	const list = into.get(currency) ?? [];
	list.push(minor);
	into.set(currency, list);
};

const toMoney = (by: Map<string, number[]>): Money[] =>
	[...by.entries()]
		.map(([currency, parts]) => ({ minor: sumMinor(parts), currency }))
		.sort((a, b) => (a.currency < b.currency ? -1 : 1));

/**
 * The group's spending and yours by category, biggest group amount first
 * (compared within the first currency only, a sort order and not a sum).
 */
export function byCategory(expenses: readonly CategoryInput[]): CategoryLine[] {
	const lines = new Map<
		string,
		{
			line: CategoryInput["category"];
			group: Map<string, number[]>;
			mine: Map<string, number[]>;
		}
	>();
	for (const e of expenses) {
		const key = e.category?.id ?? "";
		const entry = lines.get(key) ?? {
			line: e.category,
			group: new Map(),
			mine: new Map(),
		};
		add(entry.group, e.currency, toMinor(e.amount.toString(), e.currency));
		if (e.myShare != null)
			add(entry.mine, e.currency, toMinor(e.myShare.toString(), e.currency));
		lines.set(key, entry);
	}
	return [...lines.values()]
		.map(({ line, group, mine }) => ({
			id: line?.id ?? null,
			name: line?.name ?? null,
			icon: line?.icon ?? null,
			color: line?.color ?? null,
			group: toMoney(group),
			mine: toMoney(mine),
		}))
		.sort((a, b) => (b.group[0]?.minor ?? 0) - (a.group[0]?.minor ?? 0));
}

/** One person's lines with you, from a per-currency map in minor units (positive: they owe you). */
export function linesOf(byCurrency: Readonly<Record<string, number>>): Money[] {
	return Object.entries(byCurrency)
		.filter(([, minor]) => minor !== 0)
		.map(([currency, minor]) => ({ minor, currency }))
		.sort((a, b) => (a.currency < b.currency ? -1 : 1));
}

/**
 * Your share as one amount in your home currency at the reference rates, so
 * the page can say "about X" under shares in other currencies. Null when
 * there is nothing to add (no share, or every line is already home) and when
 * any line has no rate: a missing rate is never read as 1, and a part of a
 * share is not a share.
 */
export function shareAtHome(
	lines: readonly Money[],
	home: string | null,
	quotes: ReadonlyMap<string, Quote>,
): Money | null {
	if (!home || lines.length === 0) return null;
	if (lines.every((l) => l.currency === home)) return null;
	const parts: number[] = [];
	for (const line of lines) {
		if (line.currency === home) {
			parts.push(line.minor);
			continue;
		}
		const quote = quotes.get(line.currency);
		if (!quote) return null;
		parts.push(toPaymentCurrency(line.minor, line.currency, home, quote));
	}
	return { minor: sumMinor(parts), currency: home };
}
