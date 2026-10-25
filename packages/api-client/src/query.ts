import { createRouterUtils, type RouterUtils } from "@orpc/tanstack-query";
import { type Contract, contract } from "@retrospend/api-contract";
import type { MutationCache, QueryClient } from "@tanstack/query-core";
import type { RetrospendClient } from "./index";
import {
	type ApiGroup,
	EVERYTHING,
	type Invalidation,
	invalidationFor,
} from "./invalidation";

/**
 * Every query key and mutation key of this client starts with this segment,
 * so invalidating a v1 group never touches another library's queries that
 * share the same QueryClient (the web app's tRPC keys, for one).
 */
export const QUERY_KEY_ROOT = "v1";

/** TanStack Query options for every contract route: `utils.expenses.list.queryOptions({ input })`. */
export type ApiQueryUtils = RouterUtils<RetrospendClient>;

/**
 * Query and mutation options for every route in the contract, typed from
 * it. Use them with the TanStack hooks: `useQuery(utils.budget.month.queryOptions(...))`,
 * `useMutation(utils.expenses.create.mutationOptions())`.
 */
export function createApiQueryUtils(client: RetrospendClient): ApiQueryUtils {
	return createRouterUtils(client, { path: [QUERY_KEY_ROOT] });
}

const GROUPS = new Set<string>(Object.keys(contract));

function isV1Key(key: readonly unknown[]): string | null {
	const path = key[0];
	if (!Array.isArray(path) || path[0] !== QUERY_KEY_ROOT) return null;
	return typeof path[1] === "string" ? path[1] : "";
}

/**
 * Marks stale every cached v1 query the groups cover. A query whose group is
 * not in the contract any more is left alone; "everything" matches every
 * v1 query.
 */
export function invalidateGroups(
	queryClient: Pick<QueryClient, "invalidateQueries">,
	groups: Invalidation,
): Promise<void> {
	const wanted = groups === EVERYTHING ? null : new Set<string>(groups);
	return queryClient.invalidateQueries({
		predicate: (query) => {
			const group = isV1Key(query.queryKey);
			if (group === null) return false;
			return wanted === null ? true : wanted.has(group);
		},
	});
}

/** What a write made, from an event in the feed or the route it just called. */
export function invalidateForEvent(
	queryClient: Pick<QueryClient, "invalidateQueries">,
	eventType: string,
): Promise<void> {
	return invalidateGroups(queryClient, invalidationFor(eventType));
}

/** The event type a route emits (its `meta.event`), or undefined for a read or a preview. */
export function eventTypeOfRoute(path: readonly string[]): string | undefined {
	let node: unknown = contract;
	for (const key of path) node = (node as Record<string, unknown>)?.[key];
	return (node as { "~orpc"?: { meta?: { event?: string } } })?.["~orpc"]?.meta
		?.event;
}

/**
 * Invalidates by event type after every successful mutation of this client:
 * the route's own event decides which groups go stale. Returns the
 * unsubscribe. Call it once per QueryClient.
 */
export function installMutationInvalidation(
	queryClient: Pick<QueryClient, "invalidateQueries"> & {
		getMutationCache: () => MutationCache;
	},
): () => void {
	return queryClient.getMutationCache().subscribe((event) => {
		if (event.type !== "updated" || event.action.type !== "success") return;
		const key = event.mutation.options.mutationKey;
		const path = key?.[0];
		if (!Array.isArray(path) || path[0] !== QUERY_KEY_ROOT) return;
		const type = eventTypeOfRoute(path.slice(1) as string[]);
		if (type) void invalidateForEvent(queryClient, type);
	});
}

/** Group names, for tests and tooling. */
export function isApiGroup(name: string): name is ApiGroup {
	return GROUPS.has(name);
}

export type { Contract };
