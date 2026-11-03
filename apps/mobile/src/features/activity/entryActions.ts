import type { ActionDef } from "@/ui/actionRegistry";

/**
 * What can be done to an entry, in one place. An Activity row's long-press
 * menu and the entry page's overflow both read this list; the page leaves out
 * Edit (it is the header pencil) and the bulk ones, so its overflow is Make
 * recurring and Delete. Delete is always last.
 */
export type EntryActionId =
	| "edit"
	| "categorize"
	| "make-recurring"
	| "select"
	| "delete";

export const ENTRY_ACTIONS: Record<EntryActionId, ActionDef<EntryActionId>> = {
	edit: { id: "edit", icon: "Pencil" },
	categorize: { id: "categorize" },
	"make-recurring": { id: "make-recurring", icon: "Repeat" },
	select: { id: "select" },
	delete: { id: "delete", icon: "Trash2", destructive: true },
};

/** The row's order. */
export const ROW_ORDER: EntryActionId[] = [
	"edit",
	"categorize",
	"make-recurring",
	"select",
	"delete",
];

/** The entry page's overflow order (Edit is the pencil, the bulk ones are for lists). */
export const DETAIL_ORDER: EntryActionId[] = ["make-recurring", "delete"];

/** The actions of an order that are available now. */
export function entryActionsOf(
	order: readonly EntryActionId[],
	available: Partial<Record<EntryActionId, boolean>>,
): EntryActionId[] {
	return order.filter((id) => available[id] === true);
}
