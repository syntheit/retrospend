import { router } from "expo-router";
import { type ReactNode, useState } from "react";
import { useTranslations } from "use-intl";
import { useOptionalAddEntry } from "@/features/entry/AddEntryProvider";
import { useDeleteEntry } from "@/features/entry/useDeleteEntry";
import { useDeletePending } from "@/features/entry/useDeletePending";
import { MakeRecurringSheet } from "@/features/recurring/MakeRecurringSheet";
import { canRepeat } from "@/features/recurring/makeRecurring";
import { useLayoutClass } from "@/layout/useLayoutClass";
import type { MenuItem } from "@/ui/types";
import { canSelect } from "./bulk";
import { canEditEntry } from "./canEdit";
import type { ActivityItem } from "./source";

/**
 * The actions of an entry, split by where they belong. Edit is the pencil in
 * the header and opens the existing edit flow (a view never edits in place).
 * Make recurring and Delete are items of the header's overflow menu, Delete
 * last; Delete asks in a system alert (after the server's dry run) and ends in an
 * Undo toast; Make recurring shows what it changes for the template it creates. Each only where
 * the server lets you: your own expense deletes and repeats, and a split you
 * may change edits and deletes (it warns first when others owe on it, and Undo
 * brings back every share). `repeating` is true once the expense already has a
 * template.
 */
export function useEntryActions({
	item,
	editable,
	repeating,
	onChanged,
}: {
	item: ActivityItem;
	/** False while the row is a placeholder or a stale copy: nothing writes until the server's. */
	editable: boolean;
	repeating: boolean;
	/** A template was made or taken back: the facts read again. */
	onChanged: () => void;
}): {
	/** Opens the edit flow; null where the entry is not yours to change. */
	edit: (() => void) | null;
	/** The header menu: Make recurring, Delete last; empty when there are none. */
	menu: MenuItem[];
	sheets: ReactNode;
} {
	const t = useTranslations("mobile.entry");
	const add = useOptionalAddEntry();
	const { listDetail } = useLayoutClass();
	const [repeat, setRepeat] = useState(false);

	const deletePending = useDeletePending();
	// Only this phone has it: it edits and deletes where it waits (the outbox).
	const waiting = item.unsynced === true;
	const canDeleteOwn = editable && canSelect(item);
	const canDeleteSplit =
		editable && item.source === "shared" && canEditEntry(item);
	const canDelete = canDeleteOwn || canDeleteSplit;
	const canRepeatIt = editable && canRepeat(item) && item.canEdit && !repeating;
	const canEdit = editable && add !== null && canEditEntry(item);

	// Deleted: a pushed page leaves for the list, a pane shows its empty state.
	function leave() {
		if (!listDetail && router.canGoBack()) router.back();
	}
	// The system alert (after the server's dry run), then the Undo toast.
	const askDelete = useDeleteEntry({
		id: item.entityId,
		shared: canDeleteSplit,
		title: item.title,
		onDeleted: leave,
	});

	// Make recurring, then Delete (last, destructive): the header's menu.
	const menu: MenuItem[] = waiting
		? [
				{
					id: "delete",
					label: t("delete"),
					icon: "Trash2" as const,
					destructive: true,
					onPress: () =>
						deletePending({
							clientId: item.entityId,
							kind: item.kind,
							title: item.title,
							onDeleted: leave,
						}),
				},
			]
		: [
		...(canRepeatIt
			? [
					{
						id: "make-recurring",
						label: t("makeRecurring"),
						icon: "Repeat" as const,
						onPress: () => setRepeat(true),
					},
				]
			: []),
		...(canDelete
			? [
					{
						id: "delete",
						label: t("delete"),
						icon: "Trash2" as const,
						destructive: true,
						onPress: askDelete,
					},
				]
			: []),
	];

	const sheets = (
		<>
			<MakeRecurringSheet
				item={item}
				onClose={() => setRepeat(false)}
				onDone={onChanged}
				visible={repeat}
			/>
		</>
	);

	if (waiting) {
		return {
			edit:
				add !== null && item.canEdit
					? () => add.editPending(item.entityId)
					: null,
			menu,
			sheets: null,
		};
	}

	return {
		edit: canEdit
			? () =>
					add?.edit(
						item.entityId,
						item.source === "shared" ? "shared" : undefined,
					)
			: null,
		menu,
		sheets,
	};
}
