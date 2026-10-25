"use client";

import { dayKey } from "@retrospend/domain/time-zone";
import { keepPreviousData } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { api } from "~/trpc/react";
import {
	filterOf,
	type InsightsView,
	isNarrowed,
	readView,
	spanOf,
	writeView,
} from "./filter";

/**
 * The page's one view (URL-backed) and the four reads it feeds. Each read
 * keeps the previous answer on screen while the next one loads, so a chip
 * pick never blanks the page. All time waits for the day of the oldest
 * spending, which is where its span starts. Cashflow ignores the chips, so it
 * is asked only with none picked.
 */
export function useInsights() {
	const params = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();
	// Rendered after hydration only, so the browser's day is the viewer's.
	const [today] = useState(() => dayKey(new Date()));
	const [view, setViewState] = useState<InsightsView>(() =>
		readView(new URLSearchParams(params.toString()), today),
	);
	const setView = useCallback(
		(next: InsightsView) => {
			setViewState(next);
			const qs = writeView(next, today);
			router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
		},
		[router, pathname, today],
	);

	const allTime = view.range.from === null;
	const first = api.insights.firstDay.useQuery(undefined, {
		enabled: allTime,
		staleTime: 60_000,
	});
	// All time has no span until the oldest day is known.
	const ready = !allTime || first.isSuccess;
	const span = useMemo(
		() => spanOf(view.range, today, first.data?.day ?? null),
		[view.range, today, first.data],
	);
	const filter = useMemo(() => filterOf(view), [view]);
	const keep = { placeholderData: keepPreviousData, enabled: ready };
	const summary = api.insights.summary.useQuery(
		{ range: span, compare: view.compare, filter },
		keep,
	);
	const months = api.insights.months.useQuery(
		{ to: span.to, count: 6, filter },
		keep,
	);
	const ytd = api.insights.ytd.useQuery(
		{ filter },
		{ placeholderData: keepPreviousData },
	);
	const showCashflow = !isNarrowed(view);
	const cashflow = api.insights.cashflow.useQuery(
		{ range: span },
		{ ...keep, enabled: ready && showCashflow },
	);

	return {
		today,
		view,
		setView,
		span,
		summary,
		months,
		ytd,
		cashflow,
		showCashflow,
		firstDayFailed: first.isError,
		retryFirstDay: () => void first.refetch(),
	};
}
