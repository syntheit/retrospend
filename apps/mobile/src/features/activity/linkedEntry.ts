import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { rowFromParam } from "./entryRow";
import type { ActivityItem } from "./source";

/**
 * The entry a link asked for on the list-detail Activity screen: a Home row,
 * a notification or a pushed `/activity/[id]` lands here with `select` (the
 * id) and the row as a placeholder, and the entry fills the detail pane
 * instead of covering both panes.
 */
export function useLinkedEntry(): {
	id: string;
	placeholder: ActivityItem | null;
} | null {
	const { select, row } = useLocalSearchParams<{
		select?: string;
		row?: string;
	}>();
	return useMemo(
		() => (select ? { id: select, placeholder: rowFromParam(row, select) } : null),
		[select, row],
	);
}
