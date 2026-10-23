/**
 * The Recurring list's groups by due date (recurring.html): Due now, Next 30
 * days, Later, then Money in. Plus the toolbar's chip filters and search.
 * Dates only; every amount stays the server's.
 */
import { daysBetween } from "@retrospend/domain/format-date";
import { fold } from "~/components/pickers/match";
import type { RecurringItemDTO } from "~/server/services/recurring-view.service";

export type GroupId = "due" | "next30" | "later" | "in";
export type RecurringGroup = { id: GroupId; items: RecurringItemDTO[] };

/** Due or overdue and not paused: Confirm and Skip belong on the row. */
export const isDue = (r: RecurringItemDTO) =>
	r.state !== "upcoming" && !r.paused;

/** Days from today to the next date (negative when overdue). */
export const daysUntil = (r: RecurringItemDTO, today: string) =>
	daysBetween(today, r.next);

export function groupsOf(
	items: RecurringItemDTO[],
	today: string,
): RecurringGroup[] {
	const out = items.filter((r) => r.direction === "out");
	const groups: RecurringGroup[] = [
		{ id: "due", items: out.filter(isDue) },
		{
			id: "next30",
			items: out.filter((r) => !isDue(r) && daysUntil(r, today) <= 30),
		},
		{
			id: "later",
			items: out.filter((r) => !isDue(r) && daysUntil(r, today) > 30),
		},
		{ id: "in", items: items.filter((r) => r.direction === "in") },
	];
	return groups.filter((g) => g.items.length > 0);
}

export type RecurringChips = {
	autoPayOn: boolean;
	autoPayOff: boolean;
	foreign: boolean;
};

/** Search (case and accents ignored) and the chips; two auto-pay chips mean either. */
export function matches(
	r: RecurringItemDTO,
	q: string,
	chips: RecurringChips,
	homeCurrency: string,
): boolean {
	const query = fold(q.trim());
	if (query && !fold(`${r.title} ${r.category.name ?? ""}`).includes(query))
		return false;
	const autoPay = chips.autoPayOn !== chips.autoPayOff;
	if (autoPay && r.autoPay !== chips.autoPayOn) return false;
	if (chips.foreign && r.amount.currency === homeCurrency) return false;
	return true;
}
