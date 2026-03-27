import {
	defaultShouldDehydrateQuery,
	MutationCache,
	QueryCache,
	QueryClient,
} from "@tanstack/react-query";
import SuperJSON from "superjson";
import { handleMutationSuccess } from "~/lib/query-invalidation";

export const createQueryClient = () => {
	// Forward-declared so the MutationCache closure can reference it.
	// Safe because onSuccess is never called during construction.
	let queryClient!: QueryClient;

	queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				// 30s keeps data fresh across navigations without excessive refetching.
				// Queries that need different timing can override per-call.
				staleTime: 30 * 1000,
			},
			dehydrate: {
				serializeData: SuperJSON.serialize,
				shouldDehydrateQuery: (query) =>
					defaultShouldDehydrateQuery(query) ||
					query.state.status === "pending",
			},
			hydrate: {
				deserializeData: SuperJSON.deserialize,
			},
		},
		mutationCache: new MutationCache({
			onSuccess: (_data, _variables, _context, mutation) => {
				handleMutationSuccess(queryClient, mutation);
			},
			onError: (error) => {
				if (typeof window !== "undefined") {
					window.dispatchEvent(
						new CustomEvent("global-error", { detail: error }),
					);
				}
			},
		}),
		queryCache: new QueryCache({
			onError: (error) => {
				if (typeof window !== "undefined") {
					window.dispatchEvent(
						new CustomEvent("global-error", { detail: error }),
					);
				}
			},
		}),
	});

	return queryClient;
};
