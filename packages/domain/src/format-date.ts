/**
 * Calendar dates for display. Dates travel as ISO date-only strings
 * ("2026-10-19"); they are formatted in UTC so a date never shifts a day
 * with the viewer's time zone. Golden cases: vectors/display-format.vectors.json.
 */
import { baseLocale } from "./format-locale";

export type DateStyle =
	/** "Oct 19" */
	| "short"
	/** "Mon, Oct 19" */
	| "weekday"
	/** "Monday, October 19" (a page's date line) */
	| "long"
	/** "October" */
	| "month"
	/** "Oct" */
	| "monthShort";

const OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
	short: { month: "short", day: "numeric" },
	weekday: { weekday: "short", month: "short", day: "numeric" },
	long: { weekday: "long", month: "long", day: "numeric" },
	month: { month: "long" },
	monthShort: { month: "short" },
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: string, style: DateStyle): Intl.DateTimeFormat {
	const key = `${locale}|${style}`;
	const hit = cache.get(key);
	if (hit) return hit;
	let tag = baseLocale(locale).replace(/_/g, "-");
	try {
		tag = Intl.DateTimeFormat.supportedLocalesOf(tag)[0] ?? "en-US";
	} catch {
		tag = "en-US";
	}
	const f = new Intl.DateTimeFormat(tag, {
		...OPTIONS[style],
		timeZone: "UTC",
	});
	cache.set(key, f);
	return f;
}

/** Formats an ISO date-only string in the locale. Throws on anything else. */
export function formatDate(
	iso: string,
	options: { locale: string; style: DateStyle },
): string {
	const m = ISO_DATE.exec(iso);
	if (!m) throw new RangeError(`Date must be YYYY-MM-DD, got ${iso}`);
	const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
	return formatter(options.locale, options.style).format(date);
}

/** Whole days from `from` to `to` (both ISO dates); for "Today" and "Yesterday". */
export function daysBetween(from: string, to: string): number {
	const at = (iso: string) => {
		const m = ISO_DATE.exec(iso);
		if (!m) throw new RangeError(`Date must be YYYY-MM-DD, got ${iso}`);
		return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
	};
	return Math.round((at(to) - at(from)) / 86_400_000);
}
