/**
 * Date utilities for handling date-only values consistently across timezones
 */

/**
 * Parses a YYYY-MM-DD date string into a Date object representing midnight
 * in the local timezone, ensuring no timezone drift occurs.
 *
 * This prevents issues where new Date("2023-12-25") creates a UTC midnight
 * date that displays as the previous day in timezones west of UTC.
 */
export function parseDateOnly(dateString: string): Date {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
		throw new Error("Date must be in YYYY-MM-DD format");
	}

	const [year, month, day] = dateString.split("-").map(Number);

	if (year === undefined || month === undefined || day === undefined) {
		throw new Error("Invalid date components");
	}

	return new Date(year, month - 1, day);
}

/**
 * Formats a Date object as a YYYY-MM-DD string in the local timezone.
 * This ensures date-only values display consistently regardless of timezone.
 */
export function formatDateOnly(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

/**
 * Checks if a date string is in valid YYYY-MM-DD format
 */
export function isValidDateOnlyFormat(dateString: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(dateString);
}
