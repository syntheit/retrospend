import { View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { HAIRLINE } from "@/ui/metrics";
import { Text } from "@/ui/Text";
import { TextAction } from "@/ui/TextAction";
import { BULK_DELETE_LIMIT, entityIdsOf } from "./bulk";
import type { ActivityItem } from "./source";
import type { BulkActions } from "./useBulkActions";

/**
 * The bar over the list while expenses are being selected (the phone variant
 * of the mockup's bulk bar): how many are picked, Categorize, Delete and Done.
 * Both actions open a sheet with the server's dry run before anything is
 * written. Delete takes as many as one bulk delete does on the server.
 */
export function BulkControls({
	items,
	picked,
	actions,
	onDone,
}: {
	items: readonly ActivityItem[];
	picked: ReadonlySet<string>;
	actions: BulkActions;
	onDone: () => void;
}) {
	const t = useTranslations("mobile.activity.bulk");
	const { color, space } = useTheme();
	const ids = entityIdsOf(items, picked);
	const count = ids.length;
	const tooMany = count > BULK_DELETE_LIMIT;

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
					borderBottomWidth: HAIRLINE,
					borderBottomColor: color.line,
				}}
			>
				<Text
					accessibilityLiveRegion="polite"
					numberOfLines={1}
					style={{ flex: 1 }}
					weight="medium"
				>
					{count > 0 ? t("selected", { count }) : t("pickSome")}
				</Text>
				<TextAction
					disabled={count === 0}
					label={t("categorize")}
					onPress={() => actions.categorize(ids)}
				/>
				<TextAction
					disabled={count === 0 || tooMany}
					label={t("delete")}
					onPress={() => actions.remove(ids)}
				/>
				<TextAction label={t("done")} onPress={onDone} />
			</View>
			{tooMany ? (
				<Text
					style={{ paddingHorizontal: space[4], paddingTop: space[2] }}
					tone="fg2"
					variant="small"
				>
					{t("deleteLimit", { max: BULK_DELETE_LIMIT })}
				</Text>
			) : null}
		</>
	);
}
