/**
 * Calendar-date and month-key helpers. Dates are YYYY-MM-DD strings handled
 * as UTC days, so time zones never move a date (SPEC §5.1, C21). Which
 * budget month a date belongs to depends on BookPeriod start days and is the
 * engine's job; these helpers only do plain calendar math.
 */
import type { IsoDate, MonthKey } from "./types";

const DAY_MS = 86_400_000;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function parse(date: IsoDate): { y: number; m: number; d: number } {
	const match = ISO.exec(date);
	if (!match) throw new RangeError(`not a YYYY-MM-DD date: ${date}`);
	return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function toUtc(date: IsoDate): number {
	const { y, m, d } = parse(date);
	return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): IsoDate {
	return new Date(ms).toISOString().slice(0, 10);
}

export function monthKey(year: number, month: number): MonthKey {
	return year * 100 + month;
}

export function monthParts(key: MonthKey): { year: number; month: number } {
	const year = Math.floor(key / 100);
	const month = key % 100;
	if (month < 1 || month > 12) throw new RangeError(`bad month key ${key}`);
	return { year, month };
}

export function addMonths(key: MonthKey, n: number): MonthKey {
	const { year, month } = monthParts(key);
	const index = year * 12 + (month - 1) + n;
	return monthKey(Math.floor(index / 12), (index % 12) + 1);
}

/** Whole months from `from` to `to` (Nov to May = 6). */
export function monthsBetween(from: MonthKey, to: MonthKey): number {
	const a = monthParts(from);
	const b = monthParts(to);
	return (b.year - a.year) * 12 + (b.month - a.month);
}

/** The calendar month of a date (not the budget month). */
export function calendarMonthOf(date: IsoDate): MonthKey {
	const { y, m } = parse(date);
	return monthKey(y, m);
}

export function addDays(date: IsoDate, n: number): IsoDate {
	return fromUtc(toUtc(date) + n * DAY_MS);
}

/** Days from `a` to `b` (same day = 0). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
	return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

/** 0 = Sunday ... 6 = Saturday. */
export function dayOfWeek(date: IsoDate): number {
	return new Date(toUtc(date)).getUTCDay();
}

export function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * `anchor` moved by `n` calendar months, keeping the anchor's day and
 * clamping to the month's last day (Jan 31 + 1 = Feb 28, + 2 = Mar 31).
 */
export function addMonthsToDate(anchor: IsoDate, n: number): IsoDate {
	const { y, m, d } = parse(anchor);
	const { year, month } = monthParts(addMonths(monthKey(y, m), n));
	const day = Math.min(d, daysInMonth(year, month));
	return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
