/**
 * Small mappings from the recurring view model to kit props. Nothing is
 * computed: amounts and dates are the server's.
 */
import type { CategoryRef, RecurringVM } from "~/components/rows/types";
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

/** The kit row's view model: the server's fields, renamed. */
export function toRecurringVM(r: RecurringItemDTO, other: string): RecurringVM {
	return {
		id: r.id,
		title: r.title,
		category: categoryOf(r, other),
		frequency: r.frequency,
		next: r.next,
		state: r.state,
		direction: r.direction,
		amount: r.amount,
		...(r.home !== undefined ? { home: r.home } : {}),
		figure: amountFigure(r),
		autoPay: r.autoPay,
		paused: r.paused,
	};
}
