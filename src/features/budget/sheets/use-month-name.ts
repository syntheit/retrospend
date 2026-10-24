"use client";

import { useTranslations } from "next-intl";
import { useRowDates } from "~/components/rows/dates";

const isoOf = (key: number) =>
	`${Math.floor(key / 100)}-${String(key % 100).padStart(2, "0")}-01`;

/** "October" for the month key 202610 (the page locale; a month never moves with the zone). */
export function useMonthName() {
	const { month } = useRowDates();
	return (key: number) => month(isoOf(key));
}

/** "Oct 2029" for the month key 202910: a date that is a month, with its year. */
export function useMonthYear() {
	const { monthShort } = useRowDates();
	const t = useTranslations("budgetSheets.debt");
	return (key: number) =>
		t("monthYear", {
			month: monthShort(isoOf(key)),
			year: String(Math.floor(key / 100)),
		});
}
