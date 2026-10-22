"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

/**
 * Runs `refresh` after any successful mutation under one of `routers`
 * (tRPC mutation keys start with the router name). Today's expense and
 * recurring modals invalidate only the queries they knew (listFinalized,
 * recurring.list), so the v2 reads follow every save this way until the Add
 * family sheets (4G) invalidate them directly.
 */
export function useRefreshOnSave(
	routers: readonly string[],
	refresh: () => unknown,
) {
	const client = useQueryClient();
	const latest = useRef(refresh);
	latest.current = refresh;
	const key = routers.join(",");
	useEffect(() => {
		const wanted = new Set(key.split(","));
		return client.getMutationCache().subscribe((event) => {
			if (event.type !== "updated" || event.action.type !== "success") return;
			const path = event.mutation.options.mutationKey?.[0];
			const router = Array.isArray(path) ? path[0] : undefined;
			if (typeof router === "string" && wanted.has(router))
				void latest.current();
		});
	}, [client, key]);
}
