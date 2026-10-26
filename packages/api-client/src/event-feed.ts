import type { QueryClient } from "@tanstack/query-core";
import type { RetrospendClient } from "./index";
import { invalidateForEvent } from "./query";

export type EventFeedOptions = {
	/** Milliseconds between polls while the feed is caught up. Default 15 seconds. */
	intervalMs?: number;
	/** Where to start: the last cursor you stored. Omit to start from "now". */
	cursor?: string | null;
	/** Called with the new cursor after each page, so the app can store it. */
	onCursor?: (cursor: string) => void;
	/** Called for each error; the feed keeps polling. */
	onError?: (error: unknown) => void;
};

const DEFAULT_INTERVAL_MS = 15_000;

/**
 * Polls `GET /events?after=` and invalidates the queries each event makes
 * stale (invalidation.ts). Events carry ids and amounts, never rows, so the
 * feed refetches rather than patching the cache. With no starting cursor the
 * first page only finds the end of the feed (events from before this client
 * started cannot make its fresh cache stale). Returns a stop function.
 */
export function startEventFeed(
	client: RetrospendClient,
	queryClient: Pick<QueryClient, "invalidateQueries">,
	options: EventFeedOptions = {},
): () => void {
	let cursor = options.cursor ?? null;
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function drain(): Promise<void> {
		// With no cursor yet this run only walks to the end of the feed.
		const skipHistory = cursor === null;
		for (;;) {
			const page = await client.events.list(cursor ? { after: cursor } : {});
			if (stopped) return;
			if (!skipHistory)
				for (const event of page.items)
					await invalidateForEvent(queryClient, event.type);
			if (page.cursor && page.cursor !== cursor) {
				cursor = page.cursor;
				options.onCursor?.(cursor);
			}
			if (!page.hasMore) return;
		}
	}

	async function tick(): Promise<void> {
		try {
			await drain();
		} catch (error) {
			if (!stopped) options.onError?.(error);
		}
		if (!stopped)
			timer = setTimeout(tick, options.intervalMs ?? DEFAULT_INTERVAL_MS);
	}

	void tick();
	return () => {
		stopped = true;
		if (timer) clearTimeout(timer);
	};
}
