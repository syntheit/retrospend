import { Host } from "@expo/ui";
import {
	Text as ComposeText,
	HorizontalFloatingToolbar,
	TextButton,
} from "@expo/ui/jetpack-compose";
import { semantics } from "@expo/ui/jetpack-compose/modifiers";
import { useColorScheme, View } from "react-native";
import { useTranslations } from "use-intl";
import { useTheme } from "@/theme";
import { Text, useChromeTextSize } from "@/ui/Text";
import { BULK_DELETE_LIMIT, entityIdsOf } from "./bulk";
import type { ActivityItem } from "./source";
import type { BulkActions } from "./useBulkActions";

/**
 * Android's bulk bar: the Material 3 Expressive floating toolbar over the
 * list while expenses are picked, holding Categorize and Delete as text
 * buttons (Delete in danger). The count and Done live in the top bar, so
 * the screen draws this over the bottom of the list. Both actions open a
 * sheet with the server's dry run before anything is written, then end with
 * Undo, as before. The toolbar floats, so it carries the menu shadow
 * (GUIDELINE §2.5).
 *
 * The Compose toolbar can hide on scroll only when it sits in a Compose
 * scroll container; the list here is React Native, so it stays put.
 *
 * Provisional primitive (needs the owner's sign-off). Its size is the
 * Material toolbar's: a 64 dp pill (in the mockup, 64).
 */
export function BulkControls({
	items,
	picked,
	actions,
}: {
	items: readonly ActivityItem[];
	picked: ReadonlySet<string>;
	actions: BulkActions;
	onDone: () => void;
}) {
	const t = useTranslations("mobile.activity.bulk");
	const { color, space } = useTheme();
	const scheme = useColorScheme();
	const labelSize = useChromeTextSize(16);
	const ids = entityIdsOf(items, picked);
	const count = ids.length;
	const tooMany = count > BULK_DELETE_LIMIT;

	return (
		<View
			pointerEvents="box-none"
			style={{ alignItems: "center", gap: space[2] }}
		>
			{tooMany ? (
				<View
					style={{
						backgroundColor: color.raised,
						borderRadius: space[2],
						paddingHorizontal: space[3],
						paddingVertical: space[2],
					}}
				>
					<Text tone="fg2" variant="small">
						{t("deleteLimit", { max: BULK_DELETE_LIMIT })}
					</Text>
				</View>
			) : null}
			<Host
				colorScheme={
					scheme === "dark" || scheme === "light" ? scheme : undefined
				}
				matchContents
				seedColor={color.brand}
			>
				<HorizontalFloatingToolbar
					colors={{
						toolbarContainerColor: color.raised,
						toolbarContentColor: color.fg,
					}}
				>
					<TextButton
						colors={{ contentColor: color.brand }}
						enabled={count > 0}
						modifiers={[semantics({ contentDescription: t("categorize") })]}
						onClick={() => actions.categorize(ids)}
					>
						<ComposeText style={{ fontSize: labelSize }}>
							{t("categorize")}
						</ComposeText>
					</TextButton>
					<TextButton
						colors={{ contentColor: color.danger }}
						enabled={count > 0 && !tooMany}
						modifiers={[semantics({ contentDescription: t("delete") })]}
						onClick={() => actions.remove(ids)}
					>
						<ComposeText style={{ fontSize: labelSize }}>
							{t("delete")}
						</ComposeText>
					</TextButton>
				</HorizontalFloatingToolbar>
			</Host>
		</View>
	);
}
