import { useFormatter, useTranslations } from "use-intl";

/** A server day (YYYY-MM-DD) as a date at noon, so no time zone shifts it. */
export function dayDate(day: string): Date {
	const [y, m, d] = day.split("-").map(Number) as [number, number, number];
	return new Date(y, m - 1, d, 12);
}

/** True when both days fall in the same calendar year. */
export function sameYear(a: string, b: string): boolean {
	return a.slice(0, 4) === b.slice(0, 4);
}

/**
 * Days as the phone's language writes them. A range inside one year leaves
 * the year out of the first day; a range in the current year leaves it out
 * entirely. `today` is the server's today.
 */
export function useDayRange() {
	const format = useFormatter();
	const t = useTranslations("mobile.projects");
	return (
		first: string | null,
		last: string | null,
		today: string | null,
	): string | null => {
		if (!first) return null;
		const inYear = today !== null && sameYear(first, today);
		const day = (value: string, withYear: boolean) =>
			format.dateTime(dayDate(value), {
				month: "short",
				day: "numeric",
				...(withYear ? { year: "numeric" } : {}),
			});
		if (!last || last === first) return day(first, !inYear);
		const oneYear = sameYear(first, last);
		return t("range", {
			from: day(first, !oneYear),
			to: day(last, !inYear || !oneYear),
		});
	};
}
