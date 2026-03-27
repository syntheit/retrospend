import type { RouterOutputs } from "~/trpc/react";

type ActivityEntry =
	RouterOutputs["auditLog"]["projectActivityFeed"]["entries"][number];

export type EntryGroup = {
	entries: ActivityEntry[];
	key: string;
};

// Group consecutive entries from the same actor with the same action type
// that fall within a 60-second window, to surface duplicates and rapid edits.
export function groupConsecutiveEntries(entries: ActivityEntry[]): EntryGroup[] {
	const groups: EntryGroup[] = [];
	for (const entry of entries) {
		const lastGroup = groups[groups.length - 1];
		const representative = lastGroup?.entries[0];
		const lastInGroup = lastGroup?.entries[lastGroup.entries.length - 1];
		if (
			representative &&
			lastInGroup &&
			representative.actor.id !== null &&
			representative.actor.id === entry.actor.id &&
			representative.actor.type === entry.actor.type &&
			representative.actor.type !== "system" &&
			representative.action.type === entry.action.type &&
			new Date(lastInGroup.timestamp).getTime() -
				new Date(entry.timestamp).getTime() <=
				60_000
		) {
			lastGroup.entries.push(entry);
		} else {
			groups.push({ entries: [entry], key: entry.id });
		}
	}
	return groups;
}
