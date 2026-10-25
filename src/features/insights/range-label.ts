"use client";

import { useCallback } from "react";
import {
	type DateRangeValue,
	rangeLabel,
} from "~/components/pickers/date-range-model";
import { useDateFormat } from "~/components/pickers/use-date-format";

/** A range in words ("Oct 2026", "Last 30 days", "Sep 22 to Oct 21"), as the range chip says it. */
export function useRangeLabel(today: string) {
	const f = useDateFormat();
	return useCallback(
		(range: DateRangeValue) => rangeLabel(range, today, f.label),
		[today, f],
	);
}
