"use client";

import { daysBetween, formatDate } from "@retrospend/domain/format-date";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

/**
 * Row and chart dates through the domain's date formatter: ISO date-only
 * strings in, the page locale's short forms out, in UTC so a date never
 * moves a day with the viewer's time zone.
 */
export function useRowDates(today?: string) {
	const locale = useLocale();
	const t = useTranslations("rows.date");
	return useMemo(() => {
		const f = (iso: string, style: Parameters<typeof formatDate>[1]["style"]) =>
			formatDate(iso, { locale, style });
		return {
			/** "Oct 21". */
			short: (iso: string) => f(iso, "short"),
			/** "Today", "Yesterday", else "Mon, Oct 19". */
			day: (iso: string) => {
				const back = today ? daysBetween(iso, today) : null;
				if (back === 0) return t("today");
				if (back === 1) return t("yesterday");
				return f(iso, "weekday");
			},
			/** "Wednesday, October 21" (a page's date line). */
			long: (iso: string) => f(iso, "long"),
			/** "October". */
			month: (iso: string) => f(iso, "month"),
			/** "Oct". */
			monthShort: (iso: string) => f(iso, "monthShort"),
		};
	}, [locale, today, t]);
}
