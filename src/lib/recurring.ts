import { differenceInCalendarDays, getDay, isSameDay } from "date-fns";

export const FREQUENCY_LABELS: Record<string, string> = {
	WEEKLY: "Weekly",
	BIWEEKLY: "Biweekly",
	MONTHLY: "Monthly",
	QUARTERLY: "Quarterly",
	YEARLY: "Yearly",
};

/**
 * Check if a recurring template is projected to occur on a given date
 * based on its frequency and nextDueDate.
 */
export function isProjectedOnDate(
	frequency: string,
	nextDueDate: Date,
	date: Date,
): boolean {
	const dueDate = new Date(nextDueDate);

	if (isSameDay(dueDate, date)) return true;

	switch (frequency) {
		case "MONTHLY":
			return dueDate.getDate() === date.getDate();
		case "WEEKLY":
			return getDay(dueDate) === getDay(date);
		case "BIWEEKLY": {
			const dayDiff = Math.abs(differenceInCalendarDays(date, dueDate));
			return dayDiff % 14 === 0;
		}
		case "QUARTERLY":
			return (
				dueDate.getDate() === date.getDate() &&
				Math.abs(date.getMonth() - dueDate.getMonth()) % 3 === 0
			);
		case "YEARLY":
			return (
				dueDate.getDate() === date.getDate() &&
				dueDate.getMonth() === date.getMonth()
			);
		default:
			return false;
	}
}

/**
 * Convert a frequency-specific amount to its monthly equivalent.
 */
export function toMonthlyEquivalent(
	amount: number,
	frequency: string,
): number {
	switch (frequency) {
		case "WEEKLY":
			return amount * (52 / 12);
		case "BIWEEKLY":
			return amount * (26 / 12);
		case "QUARTERLY":
			return amount / 3;
		case "YEARLY":
			return amount / 12;
		default:
			return amount;
	}
}
