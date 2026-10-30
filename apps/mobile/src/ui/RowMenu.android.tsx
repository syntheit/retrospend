import { Box, DropdownMenu } from "@expo/ui/jetpack-compose";
import { size as sized } from "@expo/ui/jetpack-compose/modifiers";
import { AndroidHaptics, performAndroidHapticsAsync } from "expo-haptics";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "@/theme";
import { DropdownItems } from "./DropdownItems";
import { NativeHost } from "./NativeHost";
import { useTransient } from "./transient";
import type { RowMenuProps } from "./types";

/**
 * Android's touch-and-hold default (ViewConfiguration), instead of React
 * Native's longer 500, so the menu opens when the system says a hold is one.
 */
export const LONG_PRESS_MS = 400;

/**
 * The long-press twin of a row's swipe actions: an M3 dropdown menu anchored
 * to the row where the finger held it, with the long-press haptic. The page
 * stays in place behind it (no sheet, no scrim); a tap outside or a tab
 * switch closes it.
 */
export function RowMenu({ items, children, onPress }: RowMenuProps) {
	const { color } = useTheme();
	const [at, setAt] = useState<number | null>(null);
	const close = () => setAt(null);
	useTransient(at === null ? null : close);
	return (
		<View>
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
				onLongPress={
					items.length > 0
						? (event) => {
								performAndroidHapticsAsync(AndroidHaptics.Long_Press).catch(
									() => undefined,
								);
								setAt(event.nativeEvent.locationX);
							}
						: undefined
				}
				onPress={onPress}
			>
				{children}
			</Pressable>
			{at === null ? null : (
				<View
					pointerEvents="none"
					style={{ position: "absolute", left: at, bottom: 0 }}
				>
					<NativeHost>
						<DropdownMenu
							color={color.surface}
							expanded
							onDismissRequest={close}
						>
							<DropdownMenu.Trigger>
								<Box modifiers={[sized(1, 1)]} />
							</DropdownMenu.Trigger>
							<DropdownMenu.Items>
								<DropdownItems
									items={items}
									onPick={(item) => {
										close();
										item.onPress();
									}}
								/>
							</DropdownMenu.Items>
						</DropdownMenu>
					</NativeHost>
				</View>
			)}
		</View>
	);
}
