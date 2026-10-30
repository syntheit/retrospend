import type { RecurringItem } from "./source";

/**
 * What the Recurring search and chips choose (recurring.html): auto-pay on or
 * off, and templates in a foreign currency. Search matches the name, with
 * case and accents ignored.
 */
export interface RecurringFilter {
	autoPay: "on" | "off" | null;
	foreign: boolean;
	q: string;
}

export const NO_RECURRING_FILTER: RecurringFilter = {
	autoPay: null,
	foreign: false,
	q: "",
};

export function isRecurringFiltered(filter: RecurringFilter): boolean {
	return (
		filter.autoPay !== null || filter.foreign || filter.q.trim().length > 0
	);
}

function fold(text: string): string {
	return text
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "");
}

/** A foreign template carries its amount in the home currency (`home`). */
export function filterRecurring(
	items: readonly RecurringItem[],
	filter: RecurringFilter,
): RecurringItem[] {
	const q = fold(filter.q.trim());
	return items.filter(
		(item) =>
			(filter.autoPay === null || item.autoPay === (filter.autoPay === "on")) &&
			(!filter.foreign || item.home !== undefined) &&
			(q === "" || fold(item.title).includes(q)),
	);
}
