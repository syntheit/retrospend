import { insightsPeriod } from "@retrospend/domain/insights-figures";
import type { NarrowValues } from "@retrospend/engine/device";
import { type InsightsView, isNarrowed } from "~/features/insights/filter";

// The values each screen hands the compare: ids and month labels the page
// already holds. Null means the screen is not ready, or shows a view the
// compare never checks (only a screen's default view is held against the
// device), so it does not start a check. Values that change after a compare
// wait for the next pull that brings something new: a compare runs once per
// pull generation, so a new id is held then, not at once.

/** Settings and Home render no narrowed figure: the basis check is all they ask. */
export const NO_VALUES: NarrowValues = {};

/** Budget: the current month's envelopes. Another month, and a loading or empty page, are not compared. */
export function budgetValues(
	data:
		| {
				groups: readonly { envelopes: readonly { id: string }[] }[];
		  }
		| null
		| undefined,
	currentMonth: boolean,
): NarrowValues | null {
	if (!data || !currentMonth) return null;
	return {
		envelopeId: data.groups.flatMap((g) => g.envelopes.map((e) => e.id)),
	};
}

/** Wealth: the open accounts the page lists. */
export function wealthValues(view: {
	groups: readonly { accounts: readonly { id: string }[] }[];
}): NarrowValues {
	return { accountId: view.groups.flatMap((g) => g.accounts.map((a) => a.id)) };
}

/** Recurring: the templates the page lists, once loaded. */
export function recurringValues(
	data: { items: readonly { id: string }[] } | null | undefined,
): NarrowValues | null {
	return data ? { recurringId: data.items.map((i) => i.id) } : null;
}

/**
 * Insights: this month with nothing picked, once its reads have arrived. The
 * categories are the ones the summary ranks (spending with none has no id) and
 * the months are the bars.
 */
export function insightsValues(
	summary:
		| {
				categories: readonly { categoryId: string | null }[];
		  }
		| null
		| undefined,
	months: { months: readonly { month: string }[] } | null | undefined,
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

/**
 * Whether Insights shows the view the device figures read: the fiscal period
 * holding today, from the user's start day (the one `insightsPeriod` the
 * figures use, so the category ids and month labels come from the same span),
 * with nothing picked and no answer still the previous view's. Today is a
 * calendar day, so the period is found at noon UTC, where no zone moves the
 * day. An unknown start day (settings not loaded) is not the default.
 */
export function isDefaultInsightsView(
	view: InsightsView,
	today: string,
	startDay: number | undefined,
	placeholders: { summary: boolean; months: boolean },
): boolean {
	if (startDay === undefined) return false;
	const period = insightsPeriod({
		now: new Date(`${today}T12:00:00Z`),
		startDay,
		zone: "UTC",
	});
	return (
		!isNarrowed(view) &&
		view.range.from === period.from &&
		view.range.to === period.to &&
		!placeholders.summary &&
		!placeholders.months
	);
}
