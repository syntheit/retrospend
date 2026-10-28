/**
 * The one map from a stored category color to the 21 category-n tokens
 * (GAPS §3: "map them once"). Web, server and the apps all read it. The order
 * is the CategoryColor enum's; the tokens share one lightness and chroma, so
 * any assignment passes the contrast tests.
 */
const TONES = {
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
} as const satisfies Record<string, number>;

export const CATEGORY_TONE: Readonly<Record<string, number>> = TONES;

/** The tone of "no category": a neutral slot. */
export const NO_CATEGORY_TONE: number = TONES.slate;

/** The token number for a stored color; an unknown name gets the neutral slot. */
export function categoryTone(color: string): number {
	return CATEGORY_TONE[color] ?? NO_CATEGORY_TONE;
}
