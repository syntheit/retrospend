/**
 * Calendar math on ISO dates (yyyy-mm-dd) for DatePicker and DateRange.
 * Dates are calendar days, not instants, so everything runs in UTC and never
 * drifts with the viewer's time zone. "Today" always comes from the caller
 * (the user's time zone), never from the clock here.
 */

export type IsoDate = string;
export type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(s: string): boolean {
	const m = ISO.exec(s);
	if (!m) return false;
	const d = utc(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
	return toIso(d) === s;
}

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
const toIso = (d: Date) => d.toISOString().slice(0, 10);

function parts(iso: IsoDate) {
	const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
	return { y, m: m - 1, d };
}

/** A UTC-noon Date, for day arithmetic. */
export function dayToDate(iso: IsoDate): Date {
	const { y, m, d } = parts(iso);
	return new Date(Date.UTC(y, m, d, 12));
}

/**
 * A local-noon Date, for formatting with date-fns (which formats in local
 * time): noon stays on the same calendar day in every time zone.
 */
export function localDay(iso: IsoDate): Date {
	const { y, m, d } = parts(iso);
	return new Date(y, m, d, 12);
}

export function addDays(iso: IsoDate, n: number): IsoDate {
	const { y, m, d } = parts(iso);
	return toIso(utc(y, m, d + n));
}

export function firstOfMonth(iso: IsoDate): IsoDate {
	return `${iso.slice(0, 8)}01`;
}

export function lastOfMonth(iso: IsoDate): IsoDate {
	const { y, m } = parts(iso);
	return toIso(utc(y, m + 1, 0));
}

/** The first day of the month n months away. */
export function addMonths(iso: IsoDate, n: number): IsoDate {
	const { y, m } = parts(iso);
	return toIso(utc(y, m + n, 1));
}

export function weekday(iso: IsoDate): number {
	return dayToDate(iso).getUTCDay();
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
	return Math.round(
		(dayToDate(to).getTime() - dayToDate(from).getTime()) / 864e5,
	);
}

/** One month as grid cells: nulls before the 1st so it starts on the week start. */
export function monthCells(
	first: IsoDate,
	weekStart: WeekStart,
): (IsoDate | null)[] {
	const lead = (weekday(first) - weekStart + 7) % 7;
	const n = Number(lastOfMonth(first).slice(8));
	const cells: (IsoDate | null)[] = Array.from({ length: lead }, () => null);
	for (let d = 1; d <= n; d++)
		cells.push(`${first.slice(0, 8)}${String(d).padStart(2, "0")}`);
	return cells;
}

/** The seven weekday numbers (0 = Sunday) in display order. */
export function weekdayOrder(weekStart: WeekStart): number[] {
	return Array.from({ length: 7 }, (_, i) => (weekStart + i) % 7);
}

/**
 * Grid keys (WAI-ARIA date grid): arrows move a day or a week, Home and End
 * go to the week's ends, PageUp and PageDown move a month (Shift: a year).
 */
export function moveDay(
	iso: IsoDate,
	e: { key: string; shiftKey?: boolean },
	weekStart: WeekStart,
): IsoDate | null {
	const back = (weekday(iso) - weekStart + 7) % 7;
	switch (e.key) {
		case "ArrowLeft":
			return addDays(iso, -1);
		case "ArrowRight":
			return addDays(iso, 1);
		case "ArrowUp":
			return addDays(iso, -7);
		case "ArrowDown":
			return addDays(iso, 7);
		case "Home":
			return addDays(iso, -back);
		case "End":
			return addDays(iso, 6 - back);
		case "PageUp":
		case "PageDown": {
			const sign = e.key === "PageUp" ? -1 : 1;
			const months = e.shiftKey ? 12 * sign : sign;
			const target = addMonths(iso, months);
			const day = Math.min(
				Number(iso.slice(8)),
				Number(lastOfMonth(target).slice(8)),
			);
			return `${target.slice(0, 8)}${String(day).padStart(2, "0")}`;
		}
		default:
			return null;
	}
}

/**
 * A typed date: ISO, or day, month and year as digits in the locale's order
 * (en-US month first, everyone else day first). Returns "" for an empty field
 * and null when it cannot be read.
 */
export function parseTypedDate(
	text: string,
	locale: string,
): IsoDate | "" | null {
	const s = text.trim();
	if (!s) return "";
	if (isIsoDate(s)) return s;
	const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
	if (!m) return null;
	const [a, b] = [Number(m[1]), Number(m[2])];
	const [month, day] =
		locale === "en" || locale.startsWith("en-US") ? [a, b] : [b, a];
	const year = m[3]?.length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
	const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
	return isIsoDate(iso) ? iso : null;
}
