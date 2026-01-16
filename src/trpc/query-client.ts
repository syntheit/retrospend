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
				// With SSR, we usually want to set some default staleTime
				// above 0 to avoid refetching immediately on the client
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
