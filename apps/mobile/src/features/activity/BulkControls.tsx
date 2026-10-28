import { useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { CategoryGlyph, categoryColor } from "@/ui/Glyph";
import { PickerSheet } from "@/ui/PickerSheet";
import type { PickGroup } from "@/ui/pickGroups";
import { BulkSheet } from "./BulkSheet";
import { BULK_DELETE_LIMIT, entityIdsOf } from "./bulk";
import type { BulkAction } from "./bulkWrite";
import type { ActivityItem } from "./source";
import { TextAction } from "./TextAction";
import { useCategories } from "./useCategories";

/**
 * The bar over the list while expenses are being selected (the phone variant
 * of the mockup's bulk bar): how many are picked, Categorize, Delete and Done.
 * Both actions open a sheet with the server's dry run before anything is
 * written. Delete takes as many as one bulk delete does on the server.
 */
export function BulkControls({
	items,
	picked,
	onDone,
}: {
	items: readonly ActivityItem[];
	picked: ReadonlySet<string>;
	onDone: () => void;
}) {
	const t = useTranslations("mobile.activity.bulk");
	const tp = useTranslations("mobile.pickers");
	const { color, duration, size, space, type } = useTheme();
	const categories = useCategories();
	const [choosing, setChoosing] = useState(false);
	const [action, setAction] = useState<BulkAction | null>(null);
	// The ids the open sheet works on stay fixed while it is up.
	const shown = useRef<string[]>([]);
	const ids = entityIdsOf(items, picked);
	const count = ids.length;
	const tooMany = count > BULK_DELETE_LIMIT;

	const groups = useMemo<PickGroup[]>(
		() => [
			{
				key: "all",
				heading: tp("category.all"),
				rows: (categories.state.status === "ready"
					? categories.state.data
					: []
				).map((c) => ({
					id: c.id,
					label: c.name,
					lead: (
						<CategoryGlyph
							category={c}
							color={categoryColor(color, c.tone)}
							size={size.icon.phone}
						/>
					),
					selected: false,
				})),
			},
		],
		[categories.state, color, size.icon.phone, tp],
	);

	function openSheet(next: BulkAction) {
		shown.current = ids;
		setAction(next);
	}

	return (
		<>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: space[2],
					paddingHorizontal: space[4],
					paddingVertical: space[1],
					backgroundColor: color.raised,
					borderBottomWidth: 1,
					borderBottomColor: color.line,
				}}
			>
				<Text
					accessibilityLiveRegion="polite"
					numberOfLines={1}
					style={{
						flex: 1,
						color: color.fg,
						fontSize: type.body.size,
						fontWeight: "500",
					}}
				>
					{count > 0 ? t("selected", { count }) : t("pickSome")}
				</Text>
				<TextAction
					disabled={count === 0}
					label={t("categorize")}
					onPress={() => setChoosing(true)}
				/>
				<TextAction
					disabled={count === 0 || tooMany}
					label={t("delete")}
					onPress={() => openSheet({ kind: "delete" })}
				/>
				<TextAction label={t("done")} onPress={onDone} />
			</View>
			{tooMany ? (
				<Text
					style={{
						color: color.fg2,
						fontSize: type.small.size,
						paddingHorizontal: space[4],
						paddingTop: space[2],
					}}
				>
					{t("deleteLimit", { max: BULK_DELETE_LIMIT })}
				</Text>
			) : null}
			<PickerSheet
				clear={tp("clear")}
				empty={tp("category.empty")}
				find={tp("category.find")}
				groups={groups}
				onClose={() => setChoosing(false)}
				onSelect={(id) => {
					const name =
						categories.state.status === "ready"
							? categories.state.data.find((c) => c.id === id)?.name
							: undefined;
					// The picker is still closing: the next sheet waits for it.
					setTimeout(
						() =>
							openSheet({ kind: "category", categoryId: id, name: name ?? "" }),
						duration.sheet,
					);
				}}
				title={tp("category.title")}
				visible={choosing}
			/>
			<BulkSheet
				action={action}
				ids={shown.current}
				onClose={() => setAction(null)}
				onDone={onDone}
			/>
		</>
	);
}
