import { fold } from "@retrospend/domain/picker-match";
import type { ReactNode } from "react";

export interface PickRow {
	id: string;
	label: string;
	/** Said after the label, muted: a currency's full name. */
	detail?: string;
	/** The identity at the start of the row: a flag, a bare category glyph. */
	lead: ReactNode;
	/** What the search matches, besides the label and the detail. */
	keywords?: string[];
	selected: boolean;
}

export interface PickGroup {
	key: string;
	heading: string;
	rows: PickRow[];
	/**
	 * While searching, the best matches come first in this group (see
	 * `matchTier`) instead of the group's own order.
	 */
	ranked?: boolean;
}

/**
 * How well a row matches a folded search, 0 best: the label is the search,
 * the label starts with it, a word of the detail or a keyword starts with it,
 * or it appears somewhere. Null when it does not match at all.
 */
export function matchTier(row: PickRow, q: string): number | null {
	const label = fold(row.label);
	if (label === q) return 0;
	if (label.startsWith(q)) return 1;
	const others = [row.detail ?? "", ...(row.keywords ?? [])].map(fold);
	if (
		others.some((text) =>
			text.split(/[\s\-/(),.]+/).some((w) => w.startsWith(q)),
		)
	) {
		return 2;
	}
	return [label, ...others].some((text) => text.includes(q)) ? 3 : null;
}

/**
 * The groups left after a search, empty ones dropped. Rows keep their order,
 * except in a `ranked` group, where the closer matches come first.
 */
export function filterGroups(
	groups: readonly PickGroup[],
	query: string,
): PickGroup[] {
	const q = fold(query);
	if (!q) return groups.filter((g) => g.rows.length > 0);
	return groups
		.map((g) => {
			const found = g.rows
				.map((row, index) => ({ row, index, tier: matchTier(row, q) }))
				.filter(
					(hit): hit is { row: PickRow; index: number; tier: number } =>
						hit.tier !== null,
				);
			if (g.ranked) found.sort((a, b) => a.tier - b.tier || a.index - b.index);
			return { ...g, rows: found.map((hit) => hit.row) };
		})
		.filter((g) => g.rows.length > 0);
}
