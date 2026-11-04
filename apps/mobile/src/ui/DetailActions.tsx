import { View } from "react-native";
import { TEST_IDS } from "@/lib/testIds";
import { useTheme } from "@/theme";
import { Menu } from "./Menu";
import { TopBarAction } from "./TopBarAction";
import type { MenuItem } from "./types";

/**
 * The header's right side on a detail screen: the pencil (Edit, the common
 * action, one tap) and the overflow menu with the secondary actions and
 * Delete last. Edit first and the menu at the far end, on both platforms
 * (iOS draws the ellipsis, Android the kebab). Either is left out when there
 * is nothing behind it.
 */
export function DetailActions({
	edit,
	editLabel,
	items,
	moreLabel,
}: {
	/** Opens the edit flow; null where the entry is not yours to change. */
	edit: (() => void) | null;
	editLabel: string;
	/** The menu's items; no items, no menu. */
	items: MenuItem[];
	moreLabel: string;
}) {
	const { space } = useTheme();
	if (!edit && items.length === 0) return null;
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: space[2] }}>
			{edit ? (
				<TopBarAction
					icon="Pencil"
					id="edit"
					label={editLabel}
					onPress={edit}
					testID={TEST_IDS.sheet.edit}
				/>
			) : null}
			{items.length > 0 ? (
				<Menu
					accessibilityLabel={moreLabel}
					icon
					items={items}
					label={moreLabel}
				/>
			) : null}
		</View>
	);
}
