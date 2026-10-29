/** Rows that sit on a server day (YYYY-MM-DD). */
export interface Dated {
	date: string;
}

export interface DayGroup<T extends Dated> {
	day: string;
	expenses: T[];
}

/**
 * Rows in day groups, in the order the server sent them: one group per run
 * of the same day, so the newest day comes first as the rows do.
 */
export function groupByDay<T extends Dated>(rows: T[]): DayGroup<T>[] {
	const groups: DayGroup<T>[] = [];
	for (const row of rows) {
		const last = groups[groups.length - 1];
		if (last && last.day === row.date) last.expenses.push(row);
		else groups.push({ day: row.date, expenses: [row] });
	}
	return groups;
}
