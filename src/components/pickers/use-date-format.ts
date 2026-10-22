"use client";

import { format } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";

import { getDateFnsLocale } from "~/lib/date-locale";
import { digitOrderOf, type IsoDate, localDay, type WeekStart } from "./dates";
import type { LabelFormat } from "./date-range-model";

/**
 * Date words for the pickers in the page locale: numbers and dates follow
 * the locale, copy stays in the message catalog (GUIDELINE §7).
 */
export function useDateFormat() {
	const locale = useLocale();
	const t = useTranslations("pickers.dateRange");
	return useMemo(() => {
		const dl = getDateFnsLocale(locale);
		const fmt = (iso: IsoDate, pattern: string) =>
			format(localDay(iso), pattern, { locale: dl });
		const label: LabelFormat = {
			month: (iso) => fmt(iso, "LLL yyyy"),
			short: (iso) => fmt(iso, "MMM d"),
			long: (iso) => fmt(iso, "PP"),
			preset: (id) => t(`preset.${id}`),
			span: (from, to) => t("span", { from, to }),
			start: t("start"),
			today: t("today"),
		};
		return {
			locale,
			/** The field's digit order, from the same pattern it is shown in. */
			order: digitOrderOf(dl.formatLong.date({ width: "short" })),
			weekStart: (dl.options?.weekStartsOn ?? 0) as WeekStart,
			label,
			monthTitle: (iso: IsoDate) => fmt(iso, "LLLL yyyy"),
			dayName: (iso: IsoDate) => fmt(iso, "PPPP"),
			/** Two-letter weekday names, Sunday first. */
			weekdays: [0, 1, 2, 3, 4, 5, 6].map((n) =>
				format(new Date(2026, 0, 4 + n, 12), "EEEEEE", { locale: dl }),
			),
			field: (iso: IsoDate) => fmt(iso, "P"),
		};
	}, [locale, t]);
}
