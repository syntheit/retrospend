/**
 * Small mappings from the recurring view model to kit props. Nothing is
 * computed: amounts and dates are the server's.
 */
import type { CategoryRef } from "~/components/rows/types";
import type { RecurringItemDTO } from "~/server/services/recurring-view.service";

/** The audit id of a template's amount (scope = template id). */
export const amountFigure = (r: RecurringItemDTO) => `recurring.amount:${r.id}`;

/** The category tile; a template without a category is "Other" in a neutral slot. */
export function categoryOf(r: RecurringItemDTO, other: string): CategoryRef {
	return {
		name: r.category.name ?? other,
		icon: r.category.icon,
		tone: r.category.tone,
	};
}
