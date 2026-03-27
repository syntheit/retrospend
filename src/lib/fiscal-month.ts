/**
 * Fiscal month utilities.
 *
 * A "fiscal month" starts on the user-configured day (e.g. 15th) and ends the
 * day before the same day in the next calendar month.  The budget `period`
 * record is always keyed to the 1st of the calendar month that contains the
 * start of the fiscal period.
 *
 * Example with startDay = 15:
 *   Fiscal "March" = March 15 → April 14
 *   Budget period  = March 1
 */

/**
 * Get the fiscal month date range for a given month label.
 * @param month  Any date within the calendar month (only year+month matter)
 * @param startDay  Day of the month the fiscal period begins (1–28)
 */
export function getFiscalMonthRange(
	month: Date,
	startDay: number,
): { start: Date; end: Date } {
	if (startDay === 1) {
		// Fast path: standard calendar month
		const start = new Date(month.getFullYear(), month.getMonth(), 1);
		const end = new Date(
			month.getFullYear(),
			month.getMonth() + 1,
			0,
			23,
			59,
			59,
			999,
		);
		return { start, end };
	}

	const start = new Date(month.getFullYear(), month.getMonth(), startDay);
	const end = new Date(
		month.getFullYear(),
		month.getMonth() + 1,
		startDay - 1,
		23,
		59,
		59,
		999,
	);
	return { start, end };
}

/**
 * Get which fiscal month a date falls in (returns 1st-of-month Date label).
 * @param date  The date to classify
 * @param startDay  Day of the month the fiscal period begins (1–28)
 */
export function getCurrentFiscalMonth(date: Date, startDay: number): Date {
	if (startDay === 1) {
		return new Date(date.getFullYear(), date.getMonth(), 1);
	}

	// If the date's day is before the startDay, it belongs to the previous
	// calendar month's fiscal period.
	if (date.getDate() < startDay) {
		return new Date(date.getFullYear(), date.getMonth() - 1, 1);
	}
	return new Date(date.getFullYear(), date.getMonth(), 1);
}

/**
 * Calculate days remaining and progress in the fiscal period.
 */
export function getFiscalMonthProgress(
	now: Date,
	month: Date,
	startDay: number,
): {
	daysInPeriod: number;
	currentDay: number;
	daysRemaining: number;
	isCurrentPeriod: boolean;
} {
	const { start, end } = getFiscalMonthRange(month, startDay);

	const daysInPeriod =
		Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;

	const isCurrentPeriod = now >= start && now <= end;

	if (!isCurrentPeriod) {
		return {
			daysInPeriod,
			currentDay: daysInPeriod,
			daysRemaining: 0,
			isCurrentPeriod,
		};
	}

	const currentDay =
		Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
	const daysRemaining = Math.max(0, daysInPeriod - currentDay + 1);

	return { daysInPeriod, currentDay, daysRemaining, isCurrentPeriod };
}
