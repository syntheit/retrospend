import type { MenuItem } from "@/ui/types";
import { canSelect } from "./bulk";
import { canEditEntry } from "./canEdit";
import type { ActivityItem } from "./source";

/** The words the actions use; the screen passes its own catalogs' text. */
export interface RowActionWords {
	select: string;
	edit: string;
	categorize: string;
	delete: string;
}

/** What each action does for one row. */
export interface RowActionHandlers {
	select: () => void;
	edit: () => void;
	categorize: () => void;
	remove: () => void;
}

export interface RowActions {
	/** Long press: every action the row has, Select first. */
	menu: MenuItem[];
	/** Swipe right: Edit. */
	leading?: { label: string; onPress: () => void; tone: "brand" };
	/** Swipe left: Delete, which shows what it changes before it saves. */
	trailing?: { label: string; onPress: () => void; tone: "danger" };
}

/**
 * The actions of one Activity row, by the same rules as the web's row menu:
 * only your own personal expenses are selected, categorized and deleted (one
 * dry run and one Undo, as in a bulk), and only what the server lets you edit
 * is edited. A payment, money in or a split you cannot change has none, so its
 * row neither swipes nor opens a menu.
 */
export function rowActions(
	item: ActivityItem,
	words: RowActionWords,
	on: RowActionHandlers,
	canAdd: boolean,
): RowActions {
	const own = canSelect(item);
	const edit = canAdd && canEditEntry(item);
	const menu: MenuItem[] = [];
	if (own) menu.push({ id: "select", label: words.select, onPress: on.select });
	if (edit) menu.push({ id: "edit", label: words.edit, onPress: on.edit });
	if (own) {
		menu.push({
			id: "categorize",
			label: words.categorize,
			onPress: on.categorize,
		});
		menu.push({
			id: "delete",
			label: words.delete,
			onPress: on.remove,
			destructive: true,
		});
	}
	return {
		menu,
		leading: edit
			? { label: words.edit, onPress: on.edit, tone: "brand" }
			: undefined,
		trailing: own
			? { label: words.delete, onPress: on.remove, tone: "danger" }
			: undefined,
	};
}
