/**
 * Statement imports finalized through the import queue used to store each
 * row's date as midnight UTC instead of midnight in the user's zone. Months
 * and days are now bucketed in the user's zone, so for a user west of UTC
 * those rows read as the previous day (Oct 1 shows as Sep 30 in Buenos
 * Aires). This plans moving them to midnight of the same calendar date in the
 * user's zone. Pure; scripts/repair-import-dates.ts runs it.
 */
// Relative import: scripts run this file with tsx, without the ~ alias.
import { fromWallTime } from "../lib/time-zone";

export const IMPORT_PRICING_SOURCES = ["IMPORT", "IMPORTED"] as const;

export interface ImportDateRow {
	id: string;
	date: Date;
	pricingSource: string | null;
}

export interface ImportDateFix {
	id: string;
	from: Date;
	to: Date;
}

function isUtcMidnight(date: Date): boolean {
	return (
		date.getUTCHours() === 0 &&
		date.getUTCMinutes() === 0 &&
		date.getUTCSeconds() === 0 &&
		date.getUTCMilliseconds() === 0
	);
}

/**
 * Imported rows stored at exactly midnight UTC, moved to midnight of the same
 * calendar date in `timeZone`. Rows already at local midnight (or any other
 * time) are left alone, as are all rows for a zone that is UTC on that date.
 */
export function planImportDateRepair(
	rows: readonly ImportDateRow[],
	timeZone: string,
): ImportDateFix[] {
	const fixes: ImportDateFix[] = [];
	for (const row of rows) {
		if (
			!row.pricingSource ||
			!(IMPORT_PRICING_SOURCES as readonly string[]).includes(row.pricingSource)
		) {
			continue;
		}
		if (!isUtcMidnight(row.date)) continue;
		const to = fromWallTime(
			{
				year: row.date.getUTCFullYear(),
				month: row.date.getUTCMonth(),
				day: row.date.getUTCDate(),
			},
			timeZone,
		);
		if (to.getTime() !== row.date.getTime()) {
			fixes.push({ id: row.id, from: row.date, to });
		}
	}
	return fixes;
}
