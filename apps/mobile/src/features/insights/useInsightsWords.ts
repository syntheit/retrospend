import { formatPercent } from "@retrospend/domain/format-percent";
import type { Span } from "@retrospend/domain/insights";
import { useMemo } from "react";
import { useFormatter, useTranslations } from "use-intl";
import { useMoneyLocale } from "@/lib/money";
import { localDate, type RangeWords, rangeLabel } from "./labels";

/**
 * The words Insights puts around the server's numbers: a span in words, a
 * whole-percent change ("+31%", "new"), a share ("85%") and month names, in
 * the phone's language and the account's number format.
 */
export function useInsightsWords(today: string) {
	const t = useTranslations("mobile.insights");
	const format = useFormatter();
	const locale = useMoneyLocale();
	return useMemo(() => {
		const words: RangeWords = {
			month: (d) =>
				format.dateTime(localDate(d), { month: "short", year: "numeric" }),
			day: (d) =>
				format.dateTime(localDate(d), { month: "short", day: "numeric" }),
			dayWithYear: (d) =>
				format.dateTime(localDate(d), {
					month: "short",
					day: "numeric",
					year: "numeric",
				}),
			span: (from, to) => t("span", { from, to }),
		};
		return {
			range: (span: Span) => rangeLabel(span, today, words),
			/** The server's whole percent, signed; null reads "new". */
			change: (pct: number | null) =>
				pct === null
					? t("new")
					: formatPercent(pct * 100, { locale, digits: 0, sign: "exceptZero" }),
			percent: (pct: number) => formatPercent(pct * 100, { locale, digits: 0 }),
			/** "Oct" for a month label "2026-10". */
			monthShort: (month: string) =>
				format.dateTime(localDate(`${month}-01`), { month: "short" }),
			/** "October 2026" for a month label, for a screen reader. */
			monthLong: (month: string) =>
				format.dateTime(localDate(`${month}-01`), {
					month: "long",
					year: "numeric",
				}),
		};
	}, [t, format, locale, today]);
}

export type InsightsWords = ReturnType<typeof useInsightsWords>;
