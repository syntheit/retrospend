"use client";

import { useRowDates } from "~/components/rows/dates";

/** "October" for the month key 202610 (the page locale; a month never moves with the zone). */
export function useMonthName() {
	const { month } = useRowDates();
	return (key: number) =>
		month(`${Math.floor(key / 100)}-${String(key % 100).padStart(2, "0")}-01`);
}
