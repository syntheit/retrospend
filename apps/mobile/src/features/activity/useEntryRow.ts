import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/auth/session";
import { subscribeEntryChanges } from "@/features/entry/events";
import { type EntryRowState, loadEntryRow } from "./entryRow";
import type { ActivityItem } from "./source";

/**
 * One Activity row, read by id: on open, on each return to the screen, and
 * after any entry is added, edited, undone or deleted, so the view never
 * shows a row the server no longer has.
 */
export function useEntryRow(
	id: string,
	placeholder: ActivityItem | null,
): EntryRowState {
	const { api, local } = useSession();
	const [state, setState] = useState<EntryRowState>({
		status: "loading",
		placeholder,
	});
	const latest = useRef({ id, placeholder });
	latest.current = { id, placeholder };

	// Another row starts from its own placeholder, never the last row's data.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `id` is the trigger
	useEffect(() => {
		setState({ status: "loading", placeholder: latest.current.placeholder });
	}, [id]);

	const reload = useCallback(async () => {
		const asked = latest.current.id;
		const next = api
			? await loadEntryRow(
					asked,
					() => api.expenses.row({ id: asked }),
					local?.cache ?? null,
				)
			: ({ status: "error" } as const);
		if (latest.current.id === asked) setState(next);
	}, [api, local]);

	useEffect(() => subscribeEntryChanges(() => void reload()), [reload]);

	useFocusEffect(
		// biome-ignore lint/correctness/useExhaustiveDependencies: `id` is the trigger
		useCallback(() => {
			reload();
		}, [reload, id]),
	);

	return state;
}
