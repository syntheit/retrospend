import { canRepeat } from "@/features/recurring/makeRecurring";
import { menuOf } from "@/ui/actionRegistry";
import type { MenuItem } from "@/ui/types";
import { canSelect } from "./bulk";
import { canEditEntry } from "./canEdit";
import {
	ENTRY_ACTIONS,
	type EntryActionId,
	entryActionsOf,
	ROW_ORDER,
} from "./entryActions";
import type { ActivityItem } from "./source";

/** The words the actions use; the screen passes its own catalogs' text. */
export interface RowActionWords {
	select: string;
	edit: string;
	categorize: string;
	makeRecurring: string;
	delete: string;
}

/** What each action does for one row. */
export interface RowActionHandlers {
	/** Left out where rows are not selected in bulk (Home). */
	select?: () => void;
	edit: () => void;
	/** Left out where rows are not categorized in bulk (Home). */
	categorize?: () => void;
	/** Left out where there is no place for its sheet. */
	makeRecurring?: () => void;
	remove: () => void;
}

export interface RowActions {
	/** Long press: Edit, Categorize, Make recurring, Select, then Delete. */
	menu: MenuItem[];
	/** Swipe right: Edit. */
	leading?: { label: string; onPress: () => void; tone: "brand" };
	/** Swipe left: Delete, which shows what it changes before it saves. */
	trailing?: { label: string; onPress: () => void; tone: "danger" };
}

/**
 * The actions of one Activity row, by the same rules as the web's row menu and
 * from the entry registry (entryActions): only your own personal expenses are
 * selected, categorized and deleted, only what the server lets you edit is
 * edited, and only your own plain expense becomes a template. A payment,
 * money in or a split you cannot change has none, so its row neither swipes
 * nor opens a menu. An entry only this phone has gets Edit and Delete.
 */
export function rowActions(
	item: ActivityItem,
	words: RowActionWords,
	on: RowActionHandlers,
	canAdd: boolean,
): RowActions {
	const waiting = item.unsynced === true;
	const own = !waiting && canSelect(item);
	const edit = waiting ? canAdd && item.canEdit : canAdd && canEditEntry(item);
	const remove = waiting || own;
	const ids = entryActionsOf(ROW_ORDER, {
		edit,
		categorize: own && on.categorize !== undefined,
		"make-recurring":
			!waiting &&
			canRepeat(item) &&
			item.canEdit &&
			on.makeRecurring !== undefined,
		select: own && on.select !== undefined,
		delete: remove,
	});
	const run: Record<EntryActionId, () => void> = {
		edit: on.edit,
		categorize: on.categorize ?? on.edit,
		"make-recurring": on.makeRecurring ?? on.edit,
		select: on.select ?? on.edit,
		delete: on.remove,
	};
	const label: Record<EntryActionId, string> = {
		edit: words.edit,
		categorize: words.categorize,
		"make-recurring": words.makeRecurring,
		select: words.select,
		delete: words.delete,
	};
	return {
		menu: menuOf(ids, ENTRY_ACTIONS, label, run),
		leading: edit
			? { label: words.edit, onPress: on.edit, tone: "brand" }
			: undefined,
		trailing: remove
			? { label: words.delete, onPress: on.remove, tone: "danger" }
			: undefined,
	};
}
