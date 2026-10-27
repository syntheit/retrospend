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
}

/** The groups left after a search, empty ones dropped. Rows keep their order. */
export function filterGroups(
	groups: readonly PickGroup[],
	query: string,
): PickGroup[] {
	const q = fold(query);
	if (!q) return groups.filter((g) => g.rows.length > 0);
	return groups
		.map((g) => ({
			...g,
			rows: g.rows.filter((r) =>
				[r.label, r.detail ?? "", ...(r.keywords ?? [])].some((word) =>
					fold(word).includes(q),
				),
			),
		}))
		.filter((g) => g.rows.length > 0);
}
