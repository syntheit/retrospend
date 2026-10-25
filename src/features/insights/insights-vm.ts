/**
 * Insights reads to the kit's chart props. The server sends facts: Money,
 * whole-percent changes and figure ids. This picks labels and links; it adds
 * and compares no money (R9). A figure id is the read's `figure` narrowed by
 * `:<categoryId>` or `:<month>`, which is how the audit finds its scope.
 */

import type { MonthTotal } from "~/components/charts/monthly-bars";
import type { RankedItem } from "~/components/charts/ranked-bars";
import type { Basis, CategoryRef } from "~/components/rows/types";
import type {
	CategoryRow,
	MonthBar,
	YtdCategoryRow,
} from "~/server/services/insights/types";

/** The viewer's categories by id, with the glyph and color each one shows. */
export type CategoryRefs = ReadonlyMap<string, CategoryRef>;

export type RankWords = {
	/** Spending with no category. */
	none: string;
	/** "new": nothing before to compare with. */
	fresh: string;
	/** A signed change, from hundredths of a percent ("+53%"). */
	change: (basis: Basis) => string;
};

/** Spending with no category (or a category since removed): a neutral tag. */
const NEUTRAL_TONE = 15;

/** The server's whole percent as the formatter's hundredths of a percent. */
const basisOf = (pct: number): Basis => pct * 100;

const noteOf = (pct: number | null, words: RankWords) =>
	pct === null ? words.fresh : words.change(basisOf(pct));

type Ranked = {
	categoryId: string | null;
	figure: string;
	value: RankedItem["value"];
	note: string | undefined;
};

function toItem(
	row: Ranked,
	refs: CategoryRefs,
	words: RankWords,
	hrefOf: (categoryId: string) => string,
): RankedItem {
	const ref = row.categoryId ? refs.get(row.categoryId) : undefined;
	const category = ref ?? { name: words.none, icon: "Tag", tone: NEUTRAL_TONE };
	return {
		id: row.categoryId ?? "none",
		label: category.name,
		value: row.value,
		category,
		...(row.categoryId
			? {
					figure: `${row.figure}:${row.categoryId}`,
					href: hrefOf(row.categoryId),
				}
			: {}),
		...(row.note ? { note: row.note } : {}),
	};
}

/**
 * Rows that have an amount first, then the ones that cannot be worked out (a
 * missing rate): they stay, named, with "Not available" (R14). The order within
 * each part is the server's. A partition, not a comparison of amounts.
 */
function amountsFirst(items: RankedItem[]): RankedItem[] {
	return [...items.filter((i) => i.value), ...items.filter((i) => !i.value)];
}

/**
 * By category: largest first as the server sent them, rows without an amount
 * last. The page names the missing currencies once, in the summary line. The
 * change shows with Compare on.
 */
export function categoryItems(
	rows: readonly CategoryRow[],
	refs: CategoryRefs,
	o: {
		compare: boolean;
		words: RankWords;
		hrefOf: (categoryId: string) => string;
	},
): RankedItem[] {
	return amountsFirst(
		rows.map((row) =>
			toItem(
				{
					categoryId: row.categoryId,
					figure: row.figure,
					value: row.value,
					note:
						o.compare && row.value ? noteOf(row.changePct, o.words) : undefined,
				},
				refs,
				o.words,
				o.hrefOf,
			),
		),
	);
}

/**
 * Year to date by category, in the home currency or USD at the value each
 * expense was saved with. The server orders the rows by home value and gives
 * each its place by USD value (`usdRank`), so no amounts are compared here.
 * Every row shows its change against last year.
 */
export function ytdItems(
	rows: readonly YtdCategoryRow[],
	refs: CategoryRefs,
	o: {
		usd: boolean;
		words: RankWords;
		hrefOf: (categoryId: string) => string;
	},
): RankedItem[] {
	const ordered = o.usd
		? [...rows].sort((a, b) => a.usdRank - b.usdRank)
		: rows;
	return amountsFirst(
		ordered.map((row) => {
			const value = o.usd ? row.value.usd : row.value.home;
			return toItem(
				{
					categoryId: row.categoryId,
					figure: o.usd ? row.usdFigure : row.figure,
					value,
					note: value
						? noteOf(o.usd ? row.usdChangePct : row.changePct, o.words)
						: undefined,
				},
				refs,
				o.words,
				o.hrefOf,
			);
		}),
	);
}

/**
 * The bars of Month by month, named by the fiscal month's label ("2026-10"
 * is October whatever day the month starts on); a gap when unavailable.
 */
export function monthTotals(months: readonly MonthBar[]): MonthTotal[] {
	return months.map((m) => ({ month: `${m.month}-01`, total: m.total }));
}

/** A month bar's figure id, narrowed by its label ("insights.byMonth:2026-10"). */
export const monthFigure = (m: MonthBar) => `${m.figure}:${m.month}`;
