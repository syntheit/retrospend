import type { Money } from "@retrospend/domain/money-minor";

// What a write's dry run says, laid out the way the web's "What this changes"
// block does (src/features/budget/sheets/figure-changes.tsx): every figure that
// moved, then what was checked and stays, then what could not be checked (a
// missing rate). Nothing is added, converted or rounded here.

/** The part of a server preview every money write shares (R30). */
export interface FigureDiff {
	changes: readonly {
		id: string;
		currency: string;
		before: { minor: number; currency: string } | null;
		after: { minor: number; currency: string } | null;
	}[];
	unchanged: readonly { id: string }[];
	unavailable: readonly { id: string; before?: unknown; after?: unknown }[];
}

export interface FigureChange {
	key: string;
	id: string;
	/** Null: that side has no value (a missing rate): said as "Not available". */
	before: Money | null;
	after: Money | null;
}

export interface FigureLines {
	changes: FigureChange[];
	/** Figure ids checked and left as they are, once each. */
	stays: string[];
	/** Figure ids that could not be read, once each. */
	unavailable: string[];
}

/** Figures only some styles have: null on both sides means not applicable here, not unknown. */
const STYLE_ONLY = new Set(["budget.leftInLimits", "budget.leftThisWeek"]);

/** The figure an envelope's own lines already name. */
export const ENVELOPE_LEFT = "envelope.left";

const unique = (ids: string[]) => [...new Set(ids)];

/** A figure line that is money; a percent line is not and is left out. */
function money(line: { minor: number; currency: string } | null): Money | null {
	return line && line.currency !== "%" ? line : null;
}

/**
 * `hide` names figures the sheet's own lines already say (the envelopes it
 * moved, the account it updated); they are left out of every list.
 */
export function figureLines(
	preview: FigureDiff,
	hide: readonly string[] = [],
): FigureLines {
	const skip = new Set(hide);
	return {
		changes: preview.changes
			.filter((c) => !skip.has(c.id) && c.currency !== "%")
			.map((c) => ({
				key: `${c.id}:${c.currency}`,
				id: c.id,
				before: money(c.before),
				after: money(c.after),
			})),
		stays: unique(
			preview.unchanged.filter((u) => !skip.has(u.id)).map((u) => u.id),
		),
		unavailable: unique(
			preview.unavailable
				.filter((u) => !skip.has(u.id))
				.filter(
					(u) => !(STYLE_ONLY.has(u.id) && u.before == null && u.after == null),
				)
				.map((u) => u.id),
		),
	};
}

/** A figure id as a message key: "budget.leftToSpend" is "budget_leftToSpend". */
export function figureKey(id: string): string {
	return id.replace(/\./g, "_");
}
