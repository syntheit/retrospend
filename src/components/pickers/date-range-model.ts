/**
 * DateRange state as plain functions: presets, the click-start-click-end
 * pick, the hover preview, the comparison period and the chip label (N52).
 * A range with both ends null is All time.
 */
import {
	addDays,
	addMonths,
	daysBetween,
	firstOfMonth,
	type IsoDate,
	lastOfMonth,
} from "./dates";

export type DateRangeValue = { from: IsoDate | null; to: IsoDate | null };

export const PRESET_IDS = [
	"thisMonth",
	"lastMonth",
	"last30",
	"last90",
	"thisYear",
	"lastYear",
	"allTime",
] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export type Preset = DateRangeValue & { id: PresetId };

export function presets(today: IsoDate): Preset[] {
	const year = today.slice(0, 4);
	const lastYear = String(Number(year) - 1);
	const prevMonth = addMonths(today, -1);
	return [
		{ id: "thisMonth", from: firstOfMonth(today), to: lastOfMonth(today) },
		{ id: "lastMonth", from: prevMonth, to: lastOfMonth(prevMonth) },
		{ id: "last30", from: addDays(today, -29), to: today },
		{ id: "last90", from: addDays(today, -89), to: today },
		{ id: "thisYear", from: `${year}-01-01`, to: `${year}-12-31` },
		{ id: "lastYear", from: `${lastYear}-01-01`, to: `${lastYear}-12-31` },
		{ id: "allTime", from: null, to: null },
	];
}

export function presetOf(r: DateRangeValue, today: IsoDate): PresetId | null {
	return (
		presets(today).find((p) => p.from === r.from && p.to === r.to)?.id ?? null
	);
}

const isWholeMonth = (from: IsoDate, to: IsoDate) =>
	from.endsWith("-01") && to === lastOfMonth(from);
const isWholeYear = (from: IsoDate, to: IsoDate) =>
	from.endsWith("-01-01") && to === `${from.slice(0, 4)}-12-31`;

/** Whole months from the 1st to a month's last day: their count, else null. */
function wholeMonths(from: IsoDate, to: IsoDate): number | null {
	if (!from.endsWith("-01") || to !== lastOfMonth(to)) return null;
	const months =
		(Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
		Number(to.slice(5, 7)) -
		Number(from.slice(5, 7)) +
		1;
	return months > 0 ? months : null;
}

/**
 * The period before, for Compare: whole months (a month, a quarter, a year)
 * shift back by as many months, so Q3 compares with Q2 and 2025 with 2024;
 * any other span compares with the same number of days just before it.
 */
export function previousPeriod(r: DateRangeValue): DateRangeValue | null {
	if (!r.from || !r.to) return null;
	const months = wholeMonths(r.from, r.to);
	if (months) {
		const from = addMonths(r.from, -months);
		return { from, to: lastOfMonth(addMonths(from, months - 1)) };
	}
	const n = daysBetween(r.from, r.to) + 1;
	return { from: addDays(r.from, -n), to: addDays(r.from, -1) };
}

/** First click starts a range, the second ends it (either order), a third starts over. */
export function pickDay(r: DateRangeValue, day: IsoDate): DateRangeValue {
	if (!r.from || r.to) return { from: day, to: null };
	return day < r.from ? { from: day, to: r.from } : { from: r.from, to: day };
}

/** The ends to draw: the range, or while picking the end, start to the hovered day. */
export function drawnRange(
	r: DateRangeValue,
	hover: IsoDate | null,
): { lo: IsoDate | null; hi: IsoDate | null; preview: boolean } {
	const end = r.to ?? (r.from ? hover : null);
	if (!r.from || !end) return { lo: r.from, hi: r.from, preview: false };
	const [lo, hi] = r.from <= end ? [r.from, end] : [end, r.from];
	return { lo, hi, preview: !r.to };
}

/**
 * What Apply sends: a half-picked range becomes one day, and typed ends in
 * the wrong order are swapped, so from is never after to.
 */
export function completeRange(r: DateRangeValue): DateRangeValue {
	if (r.from && !r.to) return { from: r.from, to: r.from };
	if (r.from && r.to && r.from > r.to) return { from: r.to, to: r.from };
	return r;
}

/** The months on screen: `count` months starting at `left` (a first of month). */
export function visibleMonths(left: IsoDate, count: number): IsoDate[] {
	return Array.from({ length: count }, (_, i) => addMonths(left, i));
}

/** Turns the page just enough to show `day` (keyboard focus or a typed date). */
export function leftToShow(
	day: IsoDate,
	left: IsoDate,
	count: number,
): IsoDate {
	const first = firstOfMonth(day);
	if (first < left) return first;
	const last = addMonths(left, count - 1);
	if (first > last) return addMonths(first, -(count - 1));
	return left;
}

/** The first left month: the range's end month sits in the last column. */
export function initialLeft(
	r: DateRangeValue,
	today: IsoDate,
	count: number,
): IsoDate {
	return addMonths(firstOfMonth(r.to ?? today), -(count - 1));
}

/** Month jump choices: next month back to three years ago, newest first. */
export function jumpMonths(today: IsoDate): IsoDate[] {
	return Array.from({ length: 38 }, (_, i) => addMonths(today, 1 - i));
}

export type LabelFormat = {
	/** "Oct 2026" */
	month: (iso: IsoDate) => string;
	/** "Sep 22" (this year) */
	short: (iso: IsoDate) => string;
	/** "Sep 22, 2025" */
	long: (iso: IsoDate) => string;
	preset: (id: PresetId) => string;
	/** "{from} to {to}" */
	span: (from: string, to: string) => string;
	start: string;
	today: string;
};

/** Chip label: a whole month "Oct 2026", a whole year "2025", presets by name, else "Sep 22 to Oct 21". */
export function rangeLabel(
	r: DateRangeValue,
	today: IsoDate,
	f: LabelFormat,
): string {
	if (!r.from && !r.to) return f.preset("allTime");
	if (r.from && r.to && isWholeMonth(r.from, r.to)) return f.month(r.from);
	if (r.from && r.to && isWholeYear(r.from, r.to)) return r.from.slice(0, 4);
	const preset = presetOf(r, today);
	if (preset) return f.preset(preset);
	const day = (iso: IsoDate) =>
		iso.slice(0, 4) === today.slice(0, 4) ? f.short(iso) : f.long(iso);
	return f.span(r.from ? day(r.from) : f.start, r.to ? day(r.to) : f.today);
}
