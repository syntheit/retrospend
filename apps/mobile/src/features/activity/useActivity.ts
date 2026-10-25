import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@/auth/session";
import { subscribeEntryChanges } from "@/features/entry/events";
import { type ActivityFilter, filterString } from "./filter";
import {
	type ActivityState,
	appendPage,
	createActivitySource,
	loadActivity,
} from "./source";

/**
 * The Activity list for a filter: the first page (cache first for the
 * default list), more pages as the list scrolls, and a refresh that runs
 * when the screen comes back into focus and on pull.
 */
export function useActivity(filter: ActivityFilter) {
	const { api, local } = useSession();
	const source = useMemo(() => (api ? createActivitySource(api) : null), [api]);
	const [state, setState] = useState<ActivityState>({ status: "loading" });
	const [loadingMore, setLoadingMore] = useState(false);
	const text = filterString(filter);
	// The newest request wins: an older answer for another filter is dropped.
	const request = useRef(0);
	const filterRef = useRef(filter);
	filterRef.current = filter;

	const reload = useCallback(async () => {
		if (!source) return;
		const mine = ++request.current;
		const current = () => request.current === mine;
		const next = await loadActivity(
			source,
			local?.cache ?? null,
			filterRef.current,
			(cached) => {
				if (current()) setState(cached);
			},
		);
		if (current()) setState(next);
	}, [source, local]);

	// An entry added, undone or sent from the outbox changes the list.
	useEffect(() => subscribeEntryChanges(() => void reload()), [reload]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `text` is the trigger
	useEffect(() => {
		setState({ status: "loading" });
	}, [text]);

	useFocusEffect(
		// biome-ignore lint/correctness/useExhaustiveDependencies: `text` is the trigger
		useCallback(() => {
			reload();
		}, [reload, text]),
	);

	const loadMore = useCallback(async () => {
		// Rows from the cache are not paged on: refresh first.
		if (
			!source ||
			state.status !== "ready" ||
			state.refreshing ||
			state.staleSince ||
			loadingMore
		)
			return;
		const cursor = state.data.nextCursor;
		if (!cursor) return;
		const mine = request.current;
		setLoadingMore(true);
		try {
			const page = await source.list({ cursor, filter: text || undefined });
			if (request.current === mine) {
				setState((prev) =>
					prev.status === "ready"
						? { ...prev, data: appendPage(prev.data, page) }
						: prev,
				);
			}
		} catch {
			// The next scroll to the end tries again.
		} finally {
			setLoadingMore(false);
		}
	}, [source, state, loadingMore, text]);

	return { state, reload, loadMore, loadingMore };
}
