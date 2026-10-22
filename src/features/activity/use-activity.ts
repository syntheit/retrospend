"use client";

import { dayKey } from "@retrospend/domain/time-zone";
import { keepPreviousData } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DateRangeValue } from "~/components/pickers/date-range-model";
import { api } from "~/trpc/react";
import {
	type ActivityFilter,
	queryOf,
	readFilter,
	writeFilter,
} from "./filters";

const PAGE = 50;
const SEARCH_DELAY_MS = 250;

/**
 * The page's one filter state (URL-backed) and the listV2 pages it reads.
 * Searching covers every month (RC-10): typing clears the range, and
 * clearing the search brings the range back.
 */
export function useActivity() {
	const params = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();
	// Rendered after hydration only, so the browser's day is the viewer's.
	const [today] = useState(() => dayKey(new Date()));
	const [filter, setFilterState] = useState<ActivityFilter>(() =>
		readFilter(new URLSearchParams(params.toString()), today),
	);
	const [search, setSearch] = useState(filter.q);
	const beforeSearch = useRef<DateRangeValue | null>(null);

	const setFilter = useCallback(
		(next: ActivityFilter) => {
			setFilterState(next);
			const qs = writeFilter(next, today);
			router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
		},
		[router, pathname, today],
	);

	useEffect(() => {
		if (search === filter.q) return;
		const id = setTimeout(() => {
			let range = filter.range;
			if (search.trim() && !filter.q && (range.from || range.to)) {
				beforeSearch.current = range;
				range = { from: null, to: null };
			} else if (!search.trim() && beforeSearch.current) {
				range = beforeSearch.current;
				beforeSearch.current = null;
			}
			setFilter({ ...filter, q: search, range });
		}, SEARCH_DELAY_MS);
		return () => clearTimeout(id);
	}, [search, filter, setFilter]);

	const input = useMemo(() => ({ ...queryOf(filter), limit: PAGE }), [filter]);
	const query = api.expense.listV2.useInfiniteQuery(input, {
		getNextPageParam: (last) => last.nextCursor ?? undefined,
		placeholderData: keepPreviousData,
	});
	const pages = query.data?.pages ?? [];
	const first = pages[0];
	const rows = useMemo(() => pages.flatMap((p) => p.items), [pages]);

	return {
		today: first?.today ?? today,
		filter,
		setFilter,
		search,
		setSearch,
		rows,
		count: first?.count ?? null,
		total: first?.total ?? null,
		query,
	};
}
