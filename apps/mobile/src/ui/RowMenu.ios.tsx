import { ActionSheetIOS, Pressable } from "react-native";
import { useTranslations } from "use-intl";
import type { RowMenuProps } from "./types";

/**
 * The long-press twin of a row's swipe actions: the system action sheet,
 * so every swipe has a menu (and VoiceOver users have the actions too).
 */
export function RowMenu({ title, items, children, onPress }: RowMenuProps) {
	const t = useTranslations("mobile.common");
	function open() {
		const cancel = items.length;
		ActionSheetIOS.showActionSheetWithOptions(
			{
				title,
				options: [...items.map((item) => item.label), t("cancel")],
				cancelButtonIndex: cancel,
				destructiveButtonIndex: items.findIndex((item) => item.destructive),
			},
			(index) => items[index]?.onPress(),
		);
	}
	return (
		<Pressable
			accessibilityActions={items.map((item) => ({
				name: item.id,
				label: item.label,
			}))}
			onAccessibilityAction={(event) =>
				items
					.find((item) => item.id === event.nativeEvent.actionName)
					?.onPress()
			}
			onLongPress={open}
			onPress={onPress}
		>
			{children}
		</Pressable>
	);
}
