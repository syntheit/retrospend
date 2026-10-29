import { router } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useOptionalAddEntry } from "@/features/entry/AddEntryProvider";
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
 * The actions of an entry, under its facts: Delete on the left, Make
 * recurring and Edit on the right (the mockup's footer). Delete shows what it
 * changes before it saves and ends in an Undo toast; Make recurring does the
 * same for the template it creates. Each only where the server lets you: your
 * own expense deletes and repeats, and a split you may change edits.
 * `repeating` is true once the expense already has a template.
 */
export function EntryActions({
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
}) {
	const t = useTranslations("mobile.entry");
	const add = useOptionalAddEntry();
	const { listDetail } = useLayoutClass();
	const { color, space } = useTheme();
	const [deleting, setDeleting] = useState(false);
	const [repeat, setRepeat] = useState(false);

	const canDelete = editable && canSelect(item);
	const canRepeatIt = editable && canRepeat(item) && item.canEdit && !repeating;
	const canEdit = editable && add !== null && canEditEntry(item);
	if (!canDelete && !canRepeatIt && !canEdit) return null;

	return (
		<>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "space-between",
					gap: space[2],
					paddingTop: space[3],
					borderTopWidth: 1,
					borderTopColor: color.line,
				}}
			>
				<View>
					{canDelete ? (
						<Button
							label={t("delete")}
							onPress={() => setDeleting(true)}
							variant="outlined"
						/>
					) : null}
				</View>
				<View
					style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}
				>
					{canRepeatIt ? (
						<Button
							label={t("makeRecurring")}
							onPress={() => setRepeat(true)}
							variant="outlined"
						/>
					) : null}
					{canEdit ? (
						<Button
							label={t("edit")}
							onPress={() =>
								add?.edit(
									item.entityId,
									item.source === "shared" ? "shared" : undefined,
								)
							}
						/>
					) : null}
				</View>
			</View>
			<BulkSheet
				action={deleting ? { kind: "delete" } : null}
				ids={[item.entityId]}
				onClose={() => setDeleting(false)}
				// Deleted: a pushed page leaves for the list, a pane shows its empty state.
				onDone={() => {
					setDeleting(false);
					if (!listDetail && router.canGoBack()) router.back();
				}}
			/>
			<MakeRecurringSheet
				item={item}
				onClose={() => setRepeat(false)}
				onDone={onChanged}
				visible={repeat}
			/>
		</>
	);
}
