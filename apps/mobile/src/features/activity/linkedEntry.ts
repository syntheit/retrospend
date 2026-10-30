import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo } from "react";
import { rowFromParam } from "./entryRow";
import type { ActivityItem } from "./source";

/**
 * The entry a link asked for on the list-detail Activity screen: a Home row,
 * a notification or a pushed `/activity/[id]` lands here with `select` (the
 * id) and the row as a placeholder, and the entry fills the detail pane
 * instead of covering both panes.
 *
 * Picking another row lets go of the link (`release`), so the same link
 * again is a change the screen sees and selects its entry once more.
 */
export function useLinkedEntry(): {
	link: { id: string; placeholder: ActivityItem | null } | null;
	release: () => void;
} {
	const { select, row } = useLocalSearchParams<{
		select?: string;
		row?: string;
	}>();
	const link = useMemo(
		() =>
			select ? { id: select, placeholder: rowFromParam(row, select) } : null,
		[select, row],
	);
	const release = useCallback(() => {
		if (select) router.setParams({ select: undefined, row: undefined });
	}, [select]);
	return { link, release };
}
