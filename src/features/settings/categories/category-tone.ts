import type { CategoryColor } from "~/lib/constants";

/**
 * Stored category color names to the 21 category tokens (GAPS §3 "map them
 * once"). Each name takes the token nearest its hue (Tailwind 500 in OKLCH
 * against the token hues in tokens.css), one token per name. The design has
 * no neutral category token, so the three grays take the last free tokens.
 * Belongs in a shared module once a second page needs it.
 */
export const CATEGORY_TONE: Record<CategoryColor, number> = {
	emerald: 1,
	violet: 2,
	amber: 3,
	cyan: 4,
	pink: 5,
	lime: 6,
	blue: 7,
	orange: 8,
	teal: 9,
	fuchsia: 10,
	yellow: 11,
	sky: 12,
	rose: 13,
	neutral: 14,
	indigo: 15,
	stone: 16,
	gray: 17,
	purple: 18,
	zinc: 19,
	slate: 20,
	red: 21,
};

/** The token number for a stored color; an unknown name gets the first. */
export function categoryTone(color: string): number {
	return CATEGORY_TONE[color as CategoryColor] ?? 1;
}
