"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo } from "react";

/** The URL params of the open expense: your own (`expense`) or a shared one (`shared`). */
export const PANE_PARAMS = ["expense", "shared"] as const;

export type PaneTarget =
	| { kind: "personal"; id: string }
	| { kind: "shared"; id: string };

/** Whether this tab pushed the pane's history entry, so Close can go back. */
let pushed = false;

/**
 * The expense detail pane lives in the URL (?expense=<id> or ?shared=<id>),
 * so Back closes it and a reload or a link brings it back. Opening pushes
 * one history entry and keeps the page's other params (Activity filters).
 */
export function usePaneRoute() {
	const router = useRouter();
	const pathname = usePathname();
	const params = useSearchParams();
	const personal = params.get("expense");
	const shared = params.get("shared");
	const target: PaneTarget | null = personal
		? { kind: "personal", id: personal }
		: shared
			? { kind: "shared", id: shared }
			: null;

	useEffect(() => {
		// Closed by Back or a link: the next open is a fresh push.
		if (!target) pushed = false;
	}, [target]);

	const open = useCallback(
		(next: PaneTarget) => {
			const qs = new URLSearchParams(window.location.search);
			for (const key of PANE_PARAMS) qs.delete(key);
			qs.set(next.kind === "personal" ? "expense" : "shared", next.id);
			// A second expense replaces the first, so one Back closes the pane.
			const go = target ? router.replace : router.push;
			pushed = !target ? true : pushed;
			go(`${pathname}?${qs.toString()}`, { scroll: false });
		},
		[router, pathname, target],
	);

	const close = useCallback(() => {
		if (pushed) {
			pushed = false;
			router.back();
			return;
		}
		const qs = new URLSearchParams(window.location.search);
		for (const key of PANE_PARAMS) qs.delete(key);
		const text = qs.toString();
		router.replace(text ? `${pathname}?${text}` : pathname, { scroll: false });
	}, [router, pathname]);

	return useMemo(() => ({ target, open, close }), [target, open, close]);
}
