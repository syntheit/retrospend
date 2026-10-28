/**
 * The one map from a stored category color to the 21 category-n tokens
 * (GAPS §3: "map them once"). Web, server and the apps all read it. Each
 * name takes the token nearest its hue (Tailwind 500 in OKLCH against the
 * token hues in tokens.css), one token per name, so a blue category draws
 * blue. The design has no neutral category token, so the grays take the last
 * free tokens.
 */
const TONES = {
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
} as const satisfies Record<string, number>;

export const CATEGORY_TONE: Readonly<Record<string, number>> = TONES;

/** The tone of "no category": a neutral slot. */
export const NO_CATEGORY_TONE: number = TONES.slate;

/** The token number for a stored color; an unknown name gets the neutral slot. */
export function categoryTone(color: string): number {
	return CATEGORY_TONE[color] ?? NO_CATEGORY_TONE;
}
