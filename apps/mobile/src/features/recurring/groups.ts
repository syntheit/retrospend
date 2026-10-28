import type { RecurringItem } from "./source";

// The Recurring list's groups by due date (recurring.html): Due now, Next 30
// days, Later, then Money in. Dates only; every amount stays the server's.

export type GroupId = "due" | "next30" | "later" | "in";
export interface RecurringGroup {
	id: GroupId;
	items: RecurringItem[];
}

const DAY_MS = 86_400_000;

/** Whole days from `from` to `to`, both "YYYY-MM-DD" days (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
	const a = Date.parse(`${from}T00:00:00Z`);
	const b = Date.parse(`${to}T00:00:00Z`);
	return Math.round((b - a) / DAY_MS);
}

/** Due or overdue and not paused: a tap confirms it. */
export function isDue(item: RecurringItem): boolean {
	return item.state !== "upcoming" && !item.paused;
}

export function groupsOf(
	items: readonly RecurringItem[],
	today: string,
): RecurringGroup[] {
	const out = items.filter((r) => r.direction === "out");
	const soon = (r: RecurringItem) => daysBetween(today, r.next) <= 30;
	const groups: RecurringGroup[] = [
		{ id: "due", items: out.filter(isDue) },
		{ id: "next30", items: out.filter((r) => !isDue(r) && soon(r)) },
		{ id: "later", items: out.filter((r) => !isDue(r) && !soon(r)) },
		{ id: "in", items: items.filter((r) => r.direction === "in") },
	];
	return groups.filter((g) => g.items.length > 0);
}

export type Period = "month" | "quarter" | "year";
