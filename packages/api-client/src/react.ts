import { useQueryClient } from "@tanstack/react-query";
import { createContext, createElement, type ReactNode, useContext, useEffect, useMemo } from "react";
import { type EventFeedOptions, startEventFeed } from "./event-feed";
import type { RetrospendClient } from "./index";
import {
	type ApiQueryUtils,
	createApiQueryUtils,
	installMutationInvalidation,
} from "./query";

export type Api = { client: RetrospendClient; utils: ApiQueryUtils };

const ApiContext = createContext<Api | null>(null);

/**
 * Puts the client and its query utils in context and keeps the cache fresh:
 * each successful mutation invalidates by its route's event type, and (with
 * `feed`) the events feed does the same for writes made elsewhere. Mount it
 * once, inside the app's QueryClientProvider.
 *
 *   const { utils } = useApi();
 *   const month = useQuery(utils.budget.month.queryOptions({ input }));
 *   const create = useMutation(utils.expenses.create.mutationOptions());
 */
export function ApiProvider({
	client,
	feed,
	children,
}: {
	client: RetrospendClient;
	/** Poll the events feed. Pass options to start it; omit to rely on mutations only. */
	feed?: EventFeedOptions | true;
	children: ReactNode;
}) {
	const queryClient = useQueryClient();
	const api = useMemo(
		() => ({ client, utils: createApiQueryUtils(client) }),
		[client],
	);
	useEffect(() => installMutationInvalidation(queryClient), [queryClient]);
	const feedOn = feed !== undefined;
	// The options are read once per start: change `client` to restart the feed.
	// biome-ignore lint/correctness/useExhaustiveDependencies: see above
	useEffect(
		() =>
			feedOn
				? startEventFeed(client, queryClient, feed === true ? {} : feed)
				: undefined,
		[client, queryClient, feedOn],
	);
	return createElement(ApiContext.Provider, { value: api }, children);
}

export function useApi(): Api {
	const api = useContext(ApiContext);
	if (!api) throw new Error("useApi needs an ApiProvider above it");
	return api;
}
