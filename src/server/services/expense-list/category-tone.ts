/**
 * The one map from stored category colors to the 21 category-n tokens.
 * Pure, so the server rows and the client's pickers read the same table.
 */
import type { CategoryColor } from "~prisma";

/**
 * Stored category colors to the 21 category-n tokens, once (GAPS §3: "map
 * them once"). The order is the CategoryColor enum's.
 */
const TONES: Record<CategoryColor, number> = {
	emerald: 1,
	blue: 2,
	sky: 3,
	cyan: 4,
	teal: 5,
	orange: 6,
	amber: 7,
	violet: 8,
	pink: 9,
	fuchsia: 10,
	indigo: 11,
	slate: 12,
	zinc: 13,
	lime: 14,
	neutral: 15,
	gray: 16,
	purple: 17,
	yellow: 18,
	stone: 19,
	rose: 20,
	red: 21,
};

/** The tone of "no category": a neutral slot. */
export const NO_CATEGORY_TONE = TONES.slate;

export function categoryTone(color: CategoryColor | string): number {
	return TONES[color as CategoryColor] ?? NO_CATEGORY_TONE;
}
