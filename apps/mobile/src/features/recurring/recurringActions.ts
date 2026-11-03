import type { ActionDef } from "@/ui/actionRegistry";

/**
 * What can be done to a recurring expense, in one place: the row's swipes and
 * long-press menu and the item sheet's overflow read this order, Delete last.
 * One that is due can be confirmed or skipped first; every one opens its
 * details.
 */
export type RecurringActionId = "confirm" | "skip" | "details" | "delete";

export const RECURRING_ACTIONS: Record<
	RecurringActionId,
	ActionDef<RecurringActionId>
> = {
	confirm: { id: "confirm" },
	skip: { id: "skip" },
	details: { id: "details" },
	delete: { id: "delete", icon: "Trash2", destructive: true },
};

export function recurringActionsOf(due: boolean): RecurringActionId[] {
	return due ? ["confirm", "skip", "details", "delete"] : ["details", "delete"];
}
