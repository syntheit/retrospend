import { dayKey } from "@retrospend/domain/time-zone";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "@/auth/session";
import { useReloadOnEntryChange } from "@/features/read/useReloadOnEntryChange";
import { type ActivityFilter, filterString, isDefaultFilter } from "./filter";
import { mergePending, pendingPage } from "./pending";
import {
	type ActivityState,
	appendPage,
	createActivitySource,
	loadActivity,
} from "./source";
import { usePendingRows } from "./usePending";

/**
 * The Activity list for a filter: the first page (cache first for the
 * default list), more pages as the list scrolls, and a refresh that runs
 * when the screen comes back into focus and on pull. Entries still waiting
 * on this phone join the default list here, in this one place; a chosen
 * filter is the server's to answer.
 */
export function useActivity(filter: ActivityFilter) {
	const server = useServerActivity(filter);
	const read = server.state;
	const pending = usePendingRows(
		read.status === "ready" && !read.refreshing && read.staleSince === null
			? read.data
			: null,
	);
	const merge = isDefaultFilter(filter);
	const { state: session } = useSession();
	const home = session.status === "signedIn" ? session.me?.homeCurrency : null;
	const state = useMemo<ActivityState>(() => {
		if (!merge || pending.length === 0) return read;
		if (read.status === "ready") {
			return { ...read, data: mergePending(read.data, pending) };
		}
		// Nothing cached and no server: what was just written still shows.
		if (read.status === "error" && home) {
			return {
				status: "ready",
				data: pendingPage(pending, {
					today: dayKey(new Date()),
					homeCurrency: home,
				}),
				staleSince: new Date().toISOString(),
				refreshing: false,
			};
		}
		return read;
	}, [merge, read, pending, home]);
	return { ...server, state };
}

function useServerActivity(filter: ActivityFilter) {
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
	useReloadOnEntryChange(reload);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `text` is the trigger
	useEffect(() => {
		// The rows stay (marked as refreshing) until the new filter's answer
		// arrives; a skeleton only stands in when there is nothing to show.
		setState((prev) =>
			prev.status === "ready" && !prev.refreshing
				? { ...prev, refreshing: true }
				: prev.status === "ready"
					? prev
					: { status: "loading" },
		);
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
