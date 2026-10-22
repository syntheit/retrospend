import "server-only";

import { dehydrate } from "@tanstack/react-query";
import { createHydrationHelpers } from "@trpc/react-query/rsc";
import { headers } from "next/headers";
import { cache, createElement } from "react";

import { type AppRouter, createCaller } from "~/server/api/root";
import { createTRPCContext } from "~/server/api/trpc";
import { HydrateQueries } from "./hydrate-queries";
import { createQueryClient } from "./query-client";

/**
 * This wraps the `createTRPCContext` helper and provides the required context for the tRPC API when
 * handling a tRPC call from a React Server Component.
 */
const createContext = cache(async () => {
	const heads = new Headers(await headers());
	heads.set("x-trpc-source", "rsc");

	return createTRPCContext({
		headers: heads,
	});
});

const getQueryClient = cache(createQueryClient);
const caller = createCaller(createContext);

export const { trpc: api } = createHydrationHelpers<AppRouter>(
	caller as never,
	getQueryClient,
);

/**
 * Sends the data prefetched so far to the browser and fills the query cache
 * with it before the children render (see ~/trpc/hydrate-queries). Await the
 * prefetches first: only settled queries are sent.
 */
export function HydrateClient(props: { children: React.ReactNode }) {
	return createElement(HydrateQueries, {
		state: dehydrate(getQueryClient()),
		children: props.children,
	});
}
