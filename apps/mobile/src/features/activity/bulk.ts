import type { ActivityItem } from "./source";

// Bulk select on Activity (the web's use-bulk-actions): the same rule for
// which rows can join a selection.

/**
 * The most one bulk delete takes (BULK_DELETE_MAX in the API contract: its one
 * undo token carries every row).
 */
export const BULK_DELETE_LIMIT = 100;

/**
 * Only your own personal expenses can be picked, as on the web: not a split
 * you were added to, a payment, money in or a transfer, and nothing locked.
 */
export function canSelect(item: ActivityItem): boolean {
	return (
		item.source === "personal" &&
		item.kind === "expense" &&
		item.mine &&
		item.canEdit &&
		!item.locked
	);
}

/** The ids the entry routes take, for the rows picked, in list order. */
export function entityIdsOf(
	items: readonly ActivityItem[],
	selected: ReadonlySet<string>,
): string[] {
	return items.filter((i) => selected.has(i.id)).map((i) => i.entityId);
}
