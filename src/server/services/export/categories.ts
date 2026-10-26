import type { DecimalLike } from "~/server/services/envelope/types";
import { minorOf, minorText } from "./amounts";

export interface CategoryRow {
	category: string;
	count: number;
	currency: string;
	total: string;
}

/**
 * Expense counts and totals per category and currency: currencies sorted by
 * code, the largest total first within each. A category with expenses in two
 * currencies gets two rows; amounts in different currencies are never added.
 */
export function categoryRows(
	transactions: ReadonlyArray<{
		amount: DecimalLike;
		currency: string;
		category: { name: string } | null;
	}>,
): CategoryRow[] {
	const groups = new Map<
		string,
		{ category: string; currency: string; count: number; minor: number }
	>();
	for (const tx of transactions) {
		const category = tx.category?.name ?? "Uncategorized";
		const key = `${tx.currency}\u0000${category}`;
		const group = groups.get(key) ?? {
			category,
			currency: tx.currency,
			count: 0,
			minor: 0,
		};
		group.count += 1;
		group.minor += minorOf(tx.amount, tx.currency);
		groups.set(key, group);
	}
	return [...groups.values()]
		.sort((a, b) =>
			a.currency === b.currency
				? b.minor - a.minor
				: a.currency < b.currency
					? -1
					: 1,
		)
		.map((g) => ({
			category: g.category,
			count: g.count,
			currency: g.currency,
			total: minorText(g.minor, g.currency),
		}));
}
