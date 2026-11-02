// Calendar days as "yyyy-MM-dd" text. The server names days this way; the
// phone's own "today" is its local day, never the UTC one.

const pad = (n: number) => String(n).padStart(2, "0");

/** A day's year, month (1 to 12) and day of month. */
export function dayParts(day: string): [number, number, number] {
	const [y, m, d] = day.split("-").map(Number) as [number, number, number];
	return [y, m, d];
}

/**
 * A day as a local Date at noon (the default), so no offset or daylight
 * change moves it to another day when it is formatted.
 */
export function dayDate(day: string, hour = 12): Date {
	const [y, m, d] = dayParts(day);
	return new Date(y, m - 1, d, hour);
}

/** The phone's calendar day for an instant, as "yyyy-MM-dd". */
export function dayKey(date: Date): string {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The UTC calendar day of an instant, as "yyyy-MM-dd" (what a Material 3 date picker counts in). */
export function utcDayKey(date: Date): string {
	return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** The day `delta` days from `day`, calendar arithmetic on the text (no time zone). */
export function shiftDay(day: string, delta: number): string {
	const [y, m, d] = dayParts(day);
	return utcDayKey(new Date(Date.UTC(y, m - 1, d + delta)));
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
	const [fy, fm, fd] = dayParts(from);
	const [ty, tm, td] = dayParts(to);
	return Math.round(
		(Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000,
	);
}

/** This month's first and last day on the phone's calendar. */
export function monthDays(now: Date): { from: string; to: string } {
	const y = now.getFullYear();
	const m = now.getMonth() + 1;
	const last = new Date(y, m, 0).getDate();
	return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` };
}
