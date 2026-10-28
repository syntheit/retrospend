import type { ActivityItem } from "./source";

/**
 * What the web edits from Activity: an expense of yours alone, or a split
 * expense the server lets you change (PUT /expenses/{id} and
 * /shared-expenses/{id}). Money in, refunds and transfers are delete-only
 * there too, and a payment has no edit. A locked entry is the server's to
 * refuse.
 */
export function canEditEntry(item: ActivityItem): boolean {
	return (
		(item.source === "personal" || item.source === "shared") &&
		item.kind === "expense" &&
		item.canEdit &&
		!item.locked
	);
}
