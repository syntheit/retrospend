/** Swipe geometry as plain functions (SwipeActions draws it). dx > 0 drags right. */

export type SwipeState = "closed" | "lead" | "trail";

/** Pixels a finger moves before a horizontal drag counts as a swipe. */
export const SWIPE_SLOP = 8;

/** The row follows the finger, but never past the actions it uncovers. */
export function swipeOffset(dx: number, lead: number, trail: number): number {
	return Math.max(-trail, Math.min(lead, dx));
}

/** On release the row opens a side once it is past half its actions. */
export function settleSwipe(
	dx: number,
	lead: number,
	trail: number,
): SwipeState {
	if (lead > 0 && dx >= lead / 2) return "lead";
	if (trail > 0 && -dx >= trail / 2) return "trail";
	return "closed";
}

/** Where a settled row rests. */
export function restingOffset(
	state: SwipeState,
	lead: number,
	trail: number,
): number {
	if (state === "lead") return lead;
	if (state === "trail") return -trail;
	return 0;
}

/**
 * A drag becomes a swipe only when it is mostly sideways; a vertical drag
 * is the list scrolling.
 */
export function isSwipe(dx: number, dy: number): boolean {
	return Math.abs(dx) > SWIPE_SLOP && Math.abs(dx) > Math.abs(dy);
}
