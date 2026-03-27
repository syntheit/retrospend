import {
	defaultShouldDehydrateQuery,
	MutationCache,
	QueryCache,
	QueryClient,
} from "@tanstack/react-query";
import SuperJSON from "superjson";

export const createQueryClient = () =>
	new QueryClient({
		defaultOptions: {
			queries: {
				// Default staleTime — most data doesn't change frequently.
				// Queries that need fresher data (e.g. getServerTime) override per-call.
				staleTime: 5 * 60 * 1000,
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
