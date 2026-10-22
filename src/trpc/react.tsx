"use client";

import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchStreamLink, loggerLink } from "@trpc/client";
import { createTRPCReact } from "@trpc/react-query";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import SuperJSON from "superjson";

import type { AppRouter } from "~/server/api/root";
import { createQueryClient } from "./query-client";

let clientQueryClientSingleton: QueryClient | undefined;
const getQueryClient = () => {
	if (typeof window === "undefined") {
		// Server: always make a new query client
		return createQueryClient();
	}
	// Browser: use singleton pattern to keep the same query client
	clientQueryClientSingleton ??= createQueryClient();

	return clientQueryClientSingleton;
};

export const api = createTRPCReact<AppRouter>();

/**
 * Inference helper for inputs.
 *
 * @example type HelloInput = RouterInputs['example']['hello']
 */
export type RouterInputs = inferRouterInputs<AppRouter>;

/**
 * Inference helper for outputs.
 *
 * @example type HelloOutput = RouterOutputs['example']['hello']
 */
export type RouterOutputs = inferRouterOutputs<AppRouter>;

/** The browser's IANA time zone; the server buckets days and months in it. */
function browserTimeZone(): string | undefined {
	if (typeof window === "undefined") return undefined;
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone;
	} catch {
		return undefined;
	}
}

function TRPCProviderInner(props: {
	children: React.ReactNode;
	queryClient: QueryClient;
}) {
	const _router = useRouter();
	const { queryClient } = props;

	// Server components read the zone from this cookie (no tRPC header there).
	useEffect(() => {
		const timeZone = browserTimeZone();
		if (!timeZone) return;
		document.cookie = `tz=${encodeURIComponent(timeZone)}; path=/; max-age=31536000; samesite=lax`;
	}, []);

	const [trpcClient] = useState(() =>
		api.createClient({
			links: [
				loggerLink({
					enabled: (op) =>
						process.env.NODE_ENV === "development" ||
						(op.direction === "down" && op.result instanceof Error),
				}),
				httpBatchStreamLink({
					transformer: SuperJSON,
					url: `${getBaseUrl()}/api/trpc`,
					headers: () => {
						const headers = new Headers();
						headers.set("x-trpc-source", "nextjs-react");
						const timeZone = browserTimeZone();
						if (timeZone) headers.set("x-timezone", timeZone);
						// Include guest session token if present (set by the /join page after registration)
						if (typeof window !== "undefined") {
							const guestToken = localStorage.getItem("guest_session_token");
							if (guestToken) {
								headers.set("x-guest-token", guestToken);
							}
							// Include viewer link ID for anonymous VIEWER access (no registration)
							const viewerLinkId = localStorage.getItem("viewer_link_id");
							if (viewerLinkId) {
								headers.set("x-viewer-link-id", viewerLinkId);
							}
						}
						return headers;
					},
				}),
			],
		}),
	);

	return (
		<api.Provider client={trpcClient} queryClient={queryClient}>
			{props.children}
		</api.Provider>
	);
}

export function TRPCReactProvider(props: { children: React.ReactNode }) {
	// One client for both providers. On the server getQueryClient() returns a
	// new client per call, and tRPC hooks read the client given to api.Provider
	// while HydrationBoundary fills the one from QueryClientProvider. Two
	// clients meant SSR never saw the hydrated data and rendered loading
	// states the browser then rendered with data (React hydration error 418).
	const [queryClient] = useState(getQueryClient);

	return (
		<QueryClientProvider client={queryClient}>
			<TRPCProviderInner queryClient={queryClient}>
				{props.children}
			</TRPCProviderInner>
		</QueryClientProvider>
	);
}

function getBaseUrl() {
	if (typeof window !== "undefined") return window.location.origin;
	if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
	return `http://localhost:${process.env.PORT ?? 3000}`;
}
