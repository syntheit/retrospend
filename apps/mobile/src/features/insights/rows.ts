import type { Money } from "@retrospend/domain/money-minor";
import type { InsightsSummary, InsightsYtd } from "./source";

/**
 * Insights reads to rows and bars. The server sends facts: Money, whole
 * percent changes and the order. This picks names and words; it adds and
 * compares no money. A bar's length is a drawing, not a figure.
 */

export interface CategoryInfo {
	name: string;
	icon: string | null;
	/** The category color slot, 1 to 21. */
	tone: number;
}

export interface RankedRow {
	id: string;
	/** Null: no category, or one since removed; the row says "No category". */
	category: CategoryInfo | null;
	value: Money | null;
	/** Whole percent, signed; null reads "new". Undefined: no note. */
	change?: number | null;
}

/**
 * Rows with an amount first, then the ones a missing rate keeps out (they
 * stay, named, with "No rate yet"). The order inside each part is the
 * server's: a partition, not a comparison of amounts.
 */
function amountsFirst(rows: RankedRow[]): RankedRow[] {
	return [...rows.filter((r) => r.value), ...rows.filter((r) => !r.value)];
}

const infoOf = (
	id: string | null,
	refs: ReadonlyMap<string, CategoryInfo>,
): CategoryInfo | null => (id ? (refs.get(id) ?? null) : null);

/** By category, largest first as the server sent it; the change with Compare on. */
export function categoryRows(
	rows: InsightsSummary["categories"],
	refs: ReadonlyMap<string, CategoryInfo>,
	compare: boolean,
): RankedRow[] {
	return amountsFirst(
		rows.map((row) => ({
			id: row.categoryId ?? "none",
			category: infoOf(row.categoryId, refs),
			value: row.value,
			...(compare && row.value ? { change: row.changePct } : {}),
		})),
	);
}

/**
 * Year to date by category, in the home currency or in USD at the value each
 * expense was saved with. The server gives each row its place by USD value
 * (`usdRank`), so nothing is compared here. Every row shows its change.
 */
export function ytdRows(
	rows: InsightsYtd["categories"],
	refs: ReadonlyMap<string, CategoryInfo>,
	usd: boolean,
): RankedRow[] {
	const ordered = usd ? [...rows].sort((a, b) => a.usdRank - b.usdRank) : rows;
	return amountsFirst(
		ordered.map((row) => {
			const value = usd ? row.value.usd : row.value.home;
			return {
				id: row.categoryId ?? "none",
				category: infoOf(row.categoryId, refs),
				value,
				...(value ? { change: usd ? row.usdChangePct : row.changePct } : {}),
			};
		}),
	);
}

/**
 * How long each bar is, 0 to 1, against the longest: a ratio of minor units
 * of one currency for the drawing only. A missing amount draws no bar.
 */
export function barShares(values: readonly (Money | null)[]): number[] {
	const max = Math.max(0, ...values.map((v) => v?.minor ?? 0));
	return values.map((v) =>
		v && max > 0 ? Math.max(0, Math.min(1, v.minor / max)) : 0,
	);
}

/** The bar to highlight: the month the range ends in, else the last one. */
export function highlightIndex(
	months: readonly { month: string }[],
	rangeEnd: string,
): number {
	const at = months.findIndex((m) => m.month === rangeEnd.slice(0, 7));
	return at >= 0 ? at : months.length - 1;
}
