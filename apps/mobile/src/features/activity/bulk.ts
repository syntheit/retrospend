import type { PreviewDto } from "@/features/entry/preview";
import type { ActivityItem } from "./source";

// Bulk select on Activity (the web's use-bulk-actions): the same rule for
// which rows can join a selection, and one "what this changes" for a delete of
// several entries.

/** Delete previews run one request per row; more than this asks for a smaller pick. */
export const BULK_DELETE_LIMIT = 25;

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

/**
 * One preview for deleting several entries. The server dry-runs each delete on
 * its own (there is no bulk delete route), so the answers join here: a figure
 * that moved takes the sum of its per-row deltas (whole numbers in one
 * currency, so the sum is exact) and says nothing about "after", which only
 * the server could know for the whole set. A figure stays "unchanged" only if
 * every dry run found it so. Every summed line is marked approximate (the
 * per-row answers do not know each other); a real bulk delete preview is
 * queued. One answer is passed through as it came, exact.
 */
export function mergeDeletePreviews(diffs: readonly PreviewDto[]): PreviewDto {
	const [first] = diffs;
	if (!first) return { changes: [], unchanged: [], unavailable: [] };
	if (diffs.length === 1) return first;

	const sums = new Map<string, PreviewDto["changes"][number]>();
	for (const diff of diffs) {
		for (const change of diff.changes) {
			const key = `${change.id}|${change.currency}`;
			const seen = sums.get(key);
			sums.set(
				key,
				seen
					? {
							...seen,
							delta: {
								...seen.delta,
								minor: seen.delta.minor + change.delta.minor,
							},
						}
					: {
							...change,
							before: null,
							after: null,
							figureAfter: [],
							approx: true as const,
						},
			);
		}
	}
	const changes = [...sums.values()].filter((c) => c.delta.minor !== 0);
	const moved = new Set(changes.map((c) => c.id));

	const unavailable = new Map<string, PreviewDto["unavailable"][number]>();
	for (const diff of diffs) {
		for (const u of diff.unavailable) {
			if (!unavailable.has(u.id)) unavailable.set(u.id, u);
		}
	}
	const stays = first.unchanged.filter(
		(u) =>
			!moved.has(u.id) &&
			!unavailable.has(u.id) &&
			diffs.every((d) => d.unchanged.some((x) => x.id === u.id)),
	);
	return {
		changes,
		unchanged: stays,
		unavailable: [...unavailable.values()],
	};
}
