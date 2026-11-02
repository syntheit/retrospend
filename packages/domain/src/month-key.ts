/**
 * Month keys are YYYYMM numbers (202610 is October 2026), the budget
 * contract's own. Stepping is calendar arithmetic on the key, never on money.
 */

export function monthKey(year: number, month: number): number {
	return year * 100 + month;
}

export function monthParts(key: number): { year: number; month: number } {
	const year = Math.floor(key / 100);
	const month = key % 100;
	if (month < 1 || month > 12) throw new RangeError(`bad month key ${key}`);
	return { year, month };
}

/** The month `n` months from `key` (negative for earlier). */
export function addMonths(key: number, n: number): number {
	const { year, month } = monthParts(key);
	const index = year * 12 + (month - 1) + n;
	return monthKey(Math.floor(index / 12), (index % 12) + 1);
}
