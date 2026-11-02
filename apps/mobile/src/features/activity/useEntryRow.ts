import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/auth/session";
import { useReloadOnEntryChange } from "@/features/read/useReloadOnEntryChange";
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
	/** The entry is still on this phone: there is no server row to read. */
	skip = false,
): { state: EntryRowState; reload: () => Promise<void> } {
	const { api, local } = useSession();
	const [state, setState] = useState<EntryRowState>({
		status: "loading",
		placeholder,
	});
	const latest = useRef({ id, placeholder, skip });
	latest.current = { id, placeholder, skip };

	// Another row starts from its own placeholder, never the last row's data.
	// biome-ignore lint/correctness/useExhaustiveDependencies: `id` is the trigger
	useEffect(() => {
		setState({ status: "loading", placeholder: latest.current.placeholder });
	}, [id]);

	const reload = useCallback(async () => {
		if (latest.current.skip) return;
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

	useReloadOnEntryChange(reload);

	useFocusEffect(
		// biome-ignore lint/correctness/useExhaustiveDependencies: `id` is the trigger
		useCallback(() => {
			reload();
		}, [reload, id, skip]),
	);

	return { state, reload };
}
