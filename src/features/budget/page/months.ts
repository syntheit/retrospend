/**
 * Month keys (YYYYMM) for the page's own navigation. Dates only: no money
 * here, and the server decides which months exist (`getMonth` refuses one
 * outside the budget).
 */

export function shiftMonth(key: number, by: number): number {
	const index = Math.floor(key / 100) * 12 + (key % 100) - 1 + by;
	return Math.floor(index / 12) * 100 + (index % 12) + 1;
}

/** "2026-10-01": the first day of a month key, for the page's date formatter. */
export function monthStartIso(key: number): string {
	const month = key % 100;
	return `${Math.floor(key / 100)}-${String(month).padStart(2, "0")}-01`;
}

/** The months you can look at: the one the budget started in to the next one. */
export function monthRange(start: number, current: number): number[] {
	const last = shiftMonth(current, 1);
	const out: number[] = [];
	for (let m = start; m <= last; m = shiftMonth(m, 1)) out.push(m);
	return out;
}

/** The month the URL names, or null for the current one. */
export function parseMonthParam(value: string | null): number | null {
	if (!value || !/^\d{6}$/.test(value)) return null;
	const key = Number(value);
	return key % 100 >= 1 && key % 100 <= 12 ? key : null;
}
