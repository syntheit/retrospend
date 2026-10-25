"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "~/trpc/react";

/**
 * Home shows a little of every page, so any saved change can move one of
 * its numbers (a payment confirmed in a sheet, an expense added from the
 * shell). The global invalidation map names routers per mutation and has
 * no Home entry; rather than list Home under every mutation there, Home
 * refreshes its own reads after any mutation succeeds while it is open.
 */
export function useHomeRefresh() {
	const client = useQueryClient();
	const utils = api.useUtils();
	useEffect(
		() =>
			client.getMutationCache().subscribe((event) => {
				if (event.type !== "updated" || event.action.type !== "success") return;
				void Promise.all([
					utils.home.invalidate(),
					utils.expense.listV2.invalidate(),
					utils.people.overview.invalidate(),
					utils.recurring.listView.invalidate(),
				]);
			}),
		[client, utils],
	);
}
