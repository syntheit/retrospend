/** A server day (YYYY-MM-DD) and the phone's day, in whole days apart. */
export function daysSince(day: string, now: Date): number {
	const [y, m, d] = day.split("-").map(Number) as [number, number, number];
	const then = Date.UTC(y, m - 1, d);
	const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
	return Math.max(0, Math.round((today - then) / 86_400_000));
}

export type Ago =
	| { unit: "today" }
	| { unit: "days" | "weeks" | "months"; count: number }
	| null;

/**
 * How long ago a day was, as a short phrase's parts: today, days up to six,
 * weeks up to eight, months up to a year. Past a year it is null and the
 * caller shows the date.
 */
export function agoOf(days: number): Ago {
	if (days < 1) return { unit: "today" };
	if (days < 7) return { unit: "days", count: days };
	if (days < 60) return { unit: "weeks", count: Math.floor(days / 7) };
	if (days < 365) return { unit: "months", count: Math.floor(days / 30) };
	return null;
}
