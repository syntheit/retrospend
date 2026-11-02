// Fixed numbers the screens share that are not design tokens: the hairline,
// the stacking order of overlapping layers, and timing for waits that follow
// typing. Spacing, radii and sizes stay in the tokens (`@/theme`).

/** The line every divider and outline draws, in points. */
export const HAIRLINE = 1;

/**
 * The stacking order of layers that overlap inside one screen, lowest first:
 * `above` is a header or segment bar that casts over the list under it,
 * `bar` and `pinned` are the collapsing bar and what floats beside it,
 * `cover` hides everything below (the search view) and `lift` is a row held
 * by a finger while the others make room.
 */
export const LAYER = {
	base: 0,
	above: 1,
	bar: 2,
	pinned: 3,
	cover: 5,
	lift: 10,
} as const;

/** How long input rests before a read or a dry run follows it. */
export const TYPING_SETTLE_MS = 300;
