/**
 * Utility functions for dynamic chart granularity based on date range.
 */

export type BucketSize = "day" | "week" | "month";

/**
 * Determines the appropriate bucket size based on the date range duration.
 * - Range < 30 days: Group by day
 * - Range 30 days to 6 months: Group by week
 * - Range > 6 months: Group by month
 */
export function getBucketSize(from: Date, to: Date): BucketSize {
	const diffMs = to.getTime() - from.getTime();
	const diffDays = diffMs / (1000 * 60 * 60 * 24);

	if (diffDays < 30) {
		return "day";
	} else if (diffDays <= 180) {
		// ~6 months
		return "week";
	} else {
		return "month";
	}
}

/**
 * Formats a date for X-axis tick display based on bucket size.
 * - Day/Week: "d MMM" (e.g., "12 Dec")
 * - Month: "MMM" (e.g., "Dec")
 */
export function formatXAxisTick(date: Date, bucketSize: BucketSize): string {
	if (bucketSize === "month") {
		return date.toLocaleDateString("en-US", { month: "short" });
	}
	// Day and Week both use "d MMM" format
	return date.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

/**
 * Generates a unique key for grouping expenses into buckets.
 * - Day: "YYYY-MM-DD"
 * - Week: "YYYY-WXX" (ISO week number)
 * - Month: "YYYY-MM"
 */
export function getBucketKey(date: Date, bucketSize: BucketSize): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");

	switch (bucketSize) {
		case "day":
			return `${year}-${month}-${day}`;
		case "week": {
			// Use the Monday of the week as the key
			const dayOfWeek = date.getDay();
			const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
			const monday = new Date(date);
			monday.setDate(date.getDate() + mondayOffset);
			const mYear = monday.getFullYear();
			const mMonth = String(monday.getMonth() + 1).padStart(2, "0");
			const mDay = String(monday.getDate()).padStart(2, "0");
			return `${mYear}-${mMonth}-${mDay}`;
		}
		case "month":
			return `${year}-${month}`;
	}
}

/**
 * Parses a bucket key back to a Date object.
 */
export function getBucketStartDate(key: string, bucketSize: BucketSize): Date {
	switch (bucketSize) {
		case "day":
		case "week":
			// Key is "YYYY-MM-DD"
			return new Date(key);
		case "month":
			// Key is "YYYY-MM"
			return new Date(`${key}-01`);
	}
}

/**
 * Generates all bucket keys within a date range.
 * Useful for filling in gaps where there's no data.
 */
export function generateBucketKeys(
	from: Date,
	to: Date,
	bucketSize: BucketSize,
): string[] {
	const keys: string[] = [];
	const current = new Date(from);

	// Normalize start date based on bucket size
	if (bucketSize === "week") {
		// Move to Monday
		const dayOfWeek = current.getDay();
		const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
		current.setDate(current.getDate() + mondayOffset);
	} else if (bucketSize === "month") {
		// Move to first of month
		current.setDate(1);
	}

	while (current <= to) {
		keys.push(getBucketKey(current, bucketSize));

		switch (bucketSize) {
			case "day":
				current.setDate(current.getDate() + 1);
				break;
			case "week":
				current.setDate(current.getDate() + 7);
				break;
			case "month":
				current.setMonth(current.getMonth() + 1);
				break;
		}
	}

	return keys;
}
