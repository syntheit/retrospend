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
				// Same shape the HTTP link delivers: the JSON round trip turns
				// values like Prisma's Decimal into the strings the browser gets
				// over the wire (React cannot pass class instances to the client).
				serializeData: (data) =>
					JSON.parse(JSON.stringify(SuperJSON.serialize(data))),
				// Only settled data goes to the browser. A query sent while still
				// pending resolves at a different moment on the server and in the
				// browser, so SSR renders a loading state that the browser, which
				// hydrates nested Suspense boundaries later, renders with data
				// (React hydration error 418). Layouts await their prefetches.
				shouldDehydrateQuery: defaultShouldDehydrateQuery,
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
