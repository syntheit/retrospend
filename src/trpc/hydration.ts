import type { DehydratedState } from "@tanstack/react-query";

/**
 * Makes every in-flight query promise in a dehydrated state settle
 * asynchronously.
 *
 * Server layouts prefetch without awaiting, so their queries are dehydrated
 * while still pending, with the promise streamed to the browser. TanStack's
 * `hydrate` reads a promise synchronously when it has already resolved. During
 * SSR the promise has usually not arrived yet, so the page renders its loading
 * state; by the time the browser hydrates it has, so the first client render
 * already has data. The two trees differ and React throws hydration error 418.
 *
 * Wrapping each promise in a native one keeps the query pending for the
 * hydration render on both sides. The data still comes from the streamed
 * promise a microtask later, with no extra request.
 */
export function deferPendingQueries(
	state: DehydratedState | null | undefined,
): DehydratedState | null | undefined {
	if (!state?.queries.some((query) => query.promise)) return state;
	return {
		...state,
		queries: state.queries.map((query) => {
			const { promise } = query;
			if (!promise) return query;
			const deferred = new Promise<unknown>((resolve, reject) => {
				promise.then(resolve, reject);
			});
			// The query also rejects through its own fetch; this only silences the copy
			deferred.catch(() => undefined);
			return { ...query, promise: deferred };
		}),
	};
}
