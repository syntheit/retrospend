import {
	Button,
	ContextMenu,
	Group,
	Host,
	RNHostView,
} from "@expo/ui/swift-ui";
import { contentShape, shapes } from "@expo/ui/swift-ui/modifiers";
import { Pressable, useColorScheme } from "react-native";
import { useTheme } from "@/theme";
import type { RowMenuProps } from "./types";

/**
 * The long-press twin of a row's swipe actions: the system context menu
 * (UIContextMenu, as in Mail, Messages and Photos). A long press lifts the
 * row itself as the preview, in the panel's rounded shape, and the actions
 * hang from it; the page dims behind but stays in place. A pointer opens it
 * with a secondary click on iPad. VoiceOver reaches the same actions on the
 * row. The row's tap stays a React Native press.
 */
export function RowMenu({ items, children, onPress }: RowMenuProps) {
	const { radius } = useTheme();
	const scheme = useColorScheme();
	const row = (
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
			onPress={onPress}
		>
			{children}
		</Pressable>
	);
	if (items.length === 0) return row;
	return (
		<Host
			colorScheme={scheme === "dark" || scheme === "light" ? scheme : undefined}
			matchContents={{ vertical: true }}
		>
			<ContextMenu>
				<ContextMenu.Items>
					{items.map((item) => (
						<Button
							key={item.id}
							label={item.label}
							onPress={item.onPress}
							role={item.destructive ? "destructive" : undefined}
						/>
					))}
				</ContextMenu.Items>
				<ContextMenu.Trigger>
					<Group
						modifiers={[
							contentShape(
								shapes.roundedRectangle({ cornerRadius: radius.panel }),
								["contextMenuPreview"],
							),
						]}
					>
						<RNHostView matchContents={{ vertical: true }}>{row}</RNHostView>
					</Group>
				</ContextMenu.Trigger>
			</ContextMenu>
		</Host>
	);
}
