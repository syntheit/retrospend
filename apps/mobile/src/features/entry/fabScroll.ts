/**
 * Whether the Android add button shows its label after a scroll event
 * (Material 3 extended FAB): it shrinks to the plus while the list moves
 * down the page, extends again when it moves back up, and is always extended
 * at the very top. A move under one point keeps what the button already does.
 */
export function nextExpanded(
	current: boolean,
	offset: number,
	previousOffset: number,
): boolean {
	if (offset <= 0) return true;
	const delta = offset - previousOffset;
	if (delta >= 1) return false;
	if (delta <= -1) return true;
	return current;
}
