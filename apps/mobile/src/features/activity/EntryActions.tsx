import { router } from "expo-router";
import { type ReactNode, useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useOptionalAddEntry } from "@/features/entry/AddEntryProvider";
import { DeleteEntrySheet } from "@/features/entry/DeleteEntrySheet";
import { MakeRecurringSheet } from "@/features/recurring/MakeRecurringSheet";
import { canRepeat } from "@/features/recurring/makeRecurring";
import { useLayoutClass } from "@/layout/useLayoutClass";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import { BulkSheet } from "./BulkSheet";
import { canSelect } from "./bulk";
import { canEditEntry } from "./canEdit";
import type { ActivityItem } from "./source";

/**
 * The actions of an entry, split by where they belong. Edit is the pencil in
 * the header and opens the existing edit flow (a view never edits in place).
 * Delete and Make recurring are small quiet controls at the end of the page;
 * Delete shows what it changes before it saves and ends in an Undo toast, and
 * Make recurring does the same for the template it creates. Each only where
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
	/** The quiet controls at the page end; null when there are none. */
	footer: ReactNode;
	sheets: ReactNode;
} {
	const t = useTranslations("mobile.entry");
	const add = useOptionalAddEntry();
	const { listDetail } = useLayoutClass();
	const { space } = useTheme();
	const [deleting, setDeleting] = useState(false);
	const [repeat, setRepeat] = useState(false);

	const canDeleteOwn = editable && canSelect(item);
	const canDeleteSplit =
		editable && item.source === "shared" && canEditEntry(item);
	const canDelete = canDeleteOwn || canDeleteSplit;
	const canRepeatIt = editable && canRepeat(item) && item.canEdit && !repeating;
	const canEdit = editable && add !== null && canEditEntry(item);

	// Deleted: a pushed page leaves for the list, a pane shows its empty state.
	function leave() {
		setDeleting(false);
		if (!listDetail && router.canGoBack()) router.back();
	}

	const footer =
		canDelete || canRepeatIt ? (
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "space-between",
					gap: space[2],
					paddingTop: space[4],
				}}
			>
				<View>
					{canRepeatIt ? (
						<Button
							label={t("makeRecurring")}
							onPress={() => setRepeat(true)}
							size="small"
							variant="text"
						/>
					) : null}
				</View>
				{canDelete ? (
					<Button
						label={t("delete")}
						onPress={() => setDeleting(true)}
						size="small"
						variant="dangerText"
					/>
				) : null}
			</View>
		) : null;

	const sheets = (
		<>
			{canDeleteSplit ? (
				<DeleteEntrySheet
					id={item.entityId}
					onClose={() => setDeleting(false)}
					onDeleted={leave}
					shared
					title={item.title}
					visible={deleting}
				/>
			) : (
				<BulkSheet
					action={deleting ? { kind: "delete" } : null}
					ids={[item.entityId]}
					onClose={() => setDeleting(false)}
					onDone={leave}
				/>
			)}
			<MakeRecurringSheet
				item={item}
				onClose={() => setRepeat(false)}
				onDone={onChanged}
				visible={repeat}
			/>
		</>
	);

	return {
		edit: canEdit
			? () =>
					add?.edit(
						item.entityId,
						item.source === "shared" ? "shared" : undefined,
					)
			: null,
		footer,
		sheets,
	};
}
