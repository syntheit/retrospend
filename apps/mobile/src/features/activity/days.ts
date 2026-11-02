import type { Money } from "@retrospend/domain/money-minor";
import { shiftDay } from "@/lib/days";

export interface DaySection<T> {
	/** YYYY-MM-DD, in the caller's zone as the server sent it. */
	day: string;
	/** Today and yesterday are worded by the screen; other days show the date. */
	relative: "today" | "yesterday" | null;
	/** Your spending that day, from the server; null when it has none to give. */
	total: Money | null;
	items: T[];
}

/**
 * Rows are newest first, so a day's rows are neighbors: one section per run
 * of equal dates. `today` is the server's today, not the phone's.
 */
export function groupByDay<T extends { date: string }>(
	items: T[],
	dayTotals: Record<string, Money> | null,
	today: string,
): DaySection<T>[] {
	const yesterday = shiftDay(today, -1);
	const sections: DaySection<T>[] = [];
	for (const item of items) {
		const last = sections.at(-1);
		if (last && last.day === item.date) {
			last.items.push(item);
			continue;
		}
		sections.push({
			day: item.date,
			relative:
				item.date === today
					? "today"
					: item.date === yesterday
						? "yesterday"
						: null,
			total: dayTotals?.[item.date] ?? null,
			items: [item],
		});
	}
	return sections;
}
