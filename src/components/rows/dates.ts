"use client";

import { differenceInCalendarDays, format } from "date-fns";
import { useLocale, useTranslations } from "next-intl";
import { useCallback } from "react";
import { parseDateOnly } from "~/lib/date";
import { getDateFnsLocale } from "~/lib/date-locale";

/**
 * Row dates through the date helpers (GUIDELINE §7): ISO date-only strings
 * in, the page locale's short forms out. Labels only, no date math beyond
 * "is this today or yesterday".
 */
export function useRowDates(today?: string) {
	const locale = useLocale();
	const t = useTranslations("rows.date");
	const dfLocale = getDateFnsLocale(locale);
	/** "Oct 21". */
	const short = useCallback(
		(iso: string) => format(parseDateOnly(iso), "MMM d", { locale: dfLocale }),
		[dfLocale],
	);
	/** "Today", "Yesterday", else "Mon, Oct 19". */
	const day = useCallback(
		(iso: string) => {
			if (today) {
				const back = differenceInCalendarDays(
					parseDateOnly(today),
					parseDateOnly(iso),
				);
				if (back === 0) return t("today");
				if (back === 1) return t("yesterday");
			}
			return format(parseDateOnly(iso), "EEE, MMM d", { locale: dfLocale });
		},
		[today, dfLocale, t],
	);
	/** "October". */
	const month = useCallback(
		(iso: string) => format(parseDateOnly(iso), "LLLL", { locale: dfLocale }),
		[dfLocale],
	);
	/** "Oct". */
	const monthShort = useCallback(
		(iso: string) => format(parseDateOnly(iso), "LLL", { locale: dfLocale }),
		[dfLocale],
	);
	return { short, day, month, monthShort };
}
