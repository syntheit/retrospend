import type { NarrowValues } from "@retrospend/engine/device";

// The values each screen hands the compare: ids and month labels the page
// already holds. Null means the screen is not ready, or shows a view the
// compare never checks (only a screen's default view is held against the
// device), so it does not start a check.

/** Settings and Home render no narrowed figure: the basis check is all they ask. */
export const NO_VALUES: NarrowValues = {};

/** Budget: the current month's envelopes. Another month, and a loading or empty page, are not compared. */
export function budgetValues(
	data: { groups: { envelopes: { id: string }[] }[] } | null | undefined,
	currentMonth: boolean,
): NarrowValues | null {
	if (!data || !currentMonth) return null;
	return {
		envelopeId: data.groups.flatMap((g) => g.envelopes.map((e) => e.id)),
	};
}

/** Wealth: the open accounts the page lists. */
export function wealthValues(view: {
	groups: { accounts: { id: string }[] }[];
}): NarrowValues {
	return { accountId: view.groups.flatMap((g) => g.accounts.map((a) => a.id)) };
}

/** Recurring: the templates the page lists, once loaded. */
export function recurringValues(
	data: { items: { id: string }[] } | null | undefined,
): NarrowValues | null {
	return data ? { recurringId: data.items.map((i) => i.id) } : null;
}

/**
 * Insights: this month with nothing picked, once its reads have arrived. The
 * categories are the ones the summary ranks (spending with none has no id) and
 * the months are the bars.
 */
export function insightsValues(
	summary: { categories: { categoryId: string | null }[] } | null | undefined,
	months: { months: { month: string }[] } | null | undefined,
	defaultView: boolean,
): NarrowValues | null {
	if (!defaultView || !summary || !months) return null;
	return {
		categoryId: summary.categories.flatMap((c) =>
			c.categoryId ? [c.categoryId] : [],
		),
		month: months.months.map((m) => m.month),
	};
}
