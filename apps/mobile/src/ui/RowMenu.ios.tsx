import {
	Button,
	ContextMenu,
	Group,
	Host,
	RNHostView,
} from "@expo/ui/swift-ui";
import { contentShape, shapes } from "@expo/ui/swift-ui/modifiers";
import { useState } from "react";
import { Pressable, useColorScheme, View } from "react-native";
import { useTheme } from "@/theme";
import type { RowMenuProps } from "./types";

/**
 * How long a touch lasts before the row stops being a tap. UIKit lifts the row
 * for its context menu after about this long; a touch that outlives a tap and
 * is let go before the menu shows must not open the row either (React
 * Native's default is 500, so a release in between used to fall through to
 * the tap).
 */
export const LONG_PRESS_MS = 250;

const noop = () => undefined;

/**
 * The long-press twin of a row's swipe actions: the system context menu
 * (UIContextMenu, as in Mail, Messages and Photos). A long press lifts the
 * row itself as the preview, in the panel's rounded shape, and the actions
 * hang from it; the page dims behind but stays in place. A pointer opens it
 * with a secondary click on iPad. VoiceOver reaches the same actions on the
 * row. The row's tap stays a React Native press, which a hold past
 * LONG_PRESS_MS cancels, so a long press never opens the row: the menu shows,
 * or nothing happens.
 *
 * A row laid out inside the SwiftUI host is measured at its content width
 * (no width reaches it), so a long title never wrapped and pushed the
 * trailing button off the row (R7). The row therefore starts as a plain React
 * Native row, which lays out in the width its list gives it; once that width
 * is known the host mounts around the row with the width set on it, so the
 * hosted layout starts from the real width.
 */
export function RowMenu({ items, children, onPress }: RowMenuProps) {
	const { radius } = useTheme();
	const scheme = useColorScheme();
	const [width, setWidth] = useState<number | null>(null);
	const row = (
		<Pressable
			accessibilityActions={items.map((item) => ({
				name: item.id,
				label: item.label,
			}))}
			delayLongPress={LONG_PRESS_MS}
			onAccessibilityAction={(event) =>
				items
					.find((item) => item.id === event.nativeEvent.actionName)
					?.onPress()
			}
			// Always set: a hold on a row, with a menu or without one, does
			// nothing on release instead of falling back to a tap.
			onLongPress={noop}
			onPress={onPress}
			style={width === null ? undefined : { width }}
		>
			{children}
		</Pressable>
	);
	if (items.length === 0) return row;
	return (
		<View onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
			{width === null ? (
				row
			) : (
				<Host
					key={width}
					colorScheme={
						scheme === "dark" || scheme === "light" ? scheme : undefined
					}
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
								<RNHostView matchContents={{ vertical: true }}>
									{row}
								</RNHostView>
							</Group>
						</ContextMenu.Trigger>
					</ContextMenu>
				</Host>
			)}
		</View>
	);
}
