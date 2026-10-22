import {
	type DehydratedState,
	hydrate,
	QueryClient,
} from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { deferPendingQueries } from "~/trpc/hydration";

/**
 * A thenable that has already settled, like the promise React Flight hands the
 * browser once the streamed prefetch has arrived: `then` calls back right away.
 */
function settledThenable<T>(value: T): Promise<T> {
	return {
		// biome-ignore lint/suspicious/noThenProperty: mimics a Flight thenable
		then(onFulfilled?: (v: T) => unknown) {
			const result = onFulfilled?.(value);
			return Promise.resolve(result);
		},
	} as unknown as Promise<T>;
}

function pendingState(promise: Promise<unknown>): DehydratedState {
	return {
		mutations: [],
		queries: [
			{
				queryKey: ["settings"],
				queryHash: '["settings"]',
				dehydratedAt: Date.now(),
				promise,
				state: {
					data: undefined,
					dataUpdateCount: 0,
					dataUpdatedAt: 0,
					error: null,
					errorUpdateCount: 0,
					errorUpdatedAt: 0,
					fetchFailureCount: 0,
					fetchFailureReason: null,
					fetchMeta: null,
					isInvalidated: false,
					status: "pending",
					fetchStatus: "fetching",
				},
			},
		],
	};
}

describe("deferPendingQueries", () => {
	it("leaves a state without in-flight queries untouched", () => {
		const state: DehydratedState = { mutations: [], queries: [] };
		expect(deferPendingQueries(state)).toBe(state);
		expect(deferPendingQueries(undefined)).toBeUndefined();
	});

	it("shows why it exists: a settled promise hydrates as data right away", () => {
		// This is the browser side of hydration error 418: SSR rendered the
		// loading state, the browser's first render already has the data.
		const client = new QueryClient();
		hydrate(client, pendingState(settledThenable({ homeCurrency: "ARS" })));
		expect(client.getQueryState(["settings"])?.status).toBe("success");
	});

	it("keeps the query pending for the hydration render, then fills it", async () => {
		const client = new QueryClient();
		const state = deferPendingQueries(
			pendingState(settledThenable({ homeCurrency: "ARS" })),
		);
		hydrate(client, state ?? {});

		// Same as SSR, where the prefetch has not arrived yet
		expect(client.getQueryState(["settings"])?.status).toBe("pending");

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(client.getQueryData(["settings"])).toEqual({ homeCurrency: "ARS" });
	});

	it("passes a rejection through to the query", async () => {
		const client = new QueryClient();
		const failed = Promise.reject(new Error("redacted"));
		failed.catch(() => undefined);
		hydrate(client, deferPendingQueries(pendingState(failed)) ?? {});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(client.getQueryState(["settings"])?.status).toBe("error");
	});
});
