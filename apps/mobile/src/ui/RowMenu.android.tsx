import { Box } from "@expo/ui/jetpack-compose";
import { size as sized } from "@expo/ui/jetpack-compose/modifiers";
import { AndroidHaptics, performAndroidHapticsAsync } from "expo-haptics";
import { useRef, useState } from "react";
import { type HostInstance, Pressable, View } from "react-native";
import { useTheme } from "@/theme";
import { DropdownPanel } from "./DropdownItems";
import { NativeHost } from "./NativeHost";
import { useTransient } from "./transient";
import type { RowMenuProps } from "./types";

/**
 * Android's touch-and-hold default (ViewConfiguration), instead of React
 * Native's longer 500, so the menu opens when the system says a hold is one.
 */
export const LONG_PRESS_MS = 400;
/** A touch held longer than this is a hold, not a tap: releasing it opens nothing. */
export const TAP_MAX_MS = 250;

/**
 * The long-press twin of a row's swipe actions: an M3 dropdown menu anchored
 * to the row at the finger that held it, with the long-press haptic. The page
 * stays in place behind it (no sheet, no scrim); a tap outside or a tab
 * switch closes it.
 */
export function RowMenu({
	items,
	children,
	onPress,
	accessibilityLabel,
}: RowMenuProps) {
	const { color } = useTheme();
	const [at, setAt] = useState<{ x: number; y: number } | null>(null);
	const row = useRef<HostInstance>(null);
	const down = useRef(0);
	const close = () => setAt(null);
	useTransient(at === null ? null : close);
	return (
		<View ref={row}>
			<Pressable
				accessibilityActions={items.map((item) => ({
					name: item.id,
					label: item.label,
				}))}
				accessibilityLabel={accessibilityLabel}
				accessibilityRole={onPress ? "button" : undefined}
				// The press feedback of the row (its children carry no press of their own).
				android_ripple={onPress ? { color: color.raised } : undefined}
				delayLongPress={LONG_PRESS_MS}
				onAccessibilityAction={(event) =>
					items
						.find((item) => item.id === event.nativeEvent.actionName)
						?.onPress()
				}
				// Always set: a hold on a row with no menu then does nothing on
				// release, instead of falling back to a tap.
				onLongPress={(event) => {
					if (items.length === 0) return;
					performAndroidHapticsAsync(AndroidHaptics.Long_Press).catch(
						() => undefined,
					);
					// The finger, relative to the row (the touch target can be a child).
					const { pageX, pageY } = event.nativeEvent;
					row.current?.measure((_x, _y, _w, _h, rowX, rowY) =>
						setAt({ x: pageX - rowX, y: pageY - rowY }),
					);
				}}
				onPress={
					onPress
						? () => {
								if (Date.now() - down.current <= TAP_MAX_MS) onPress();
							}
						: undefined
				}
				onPressIn={() => {
					down.current = Date.now();
				}}
			>
				{children}
			</Pressable>
			{at === null ? null : (
				<View
					pointerEvents="none"
					style={{ position: "absolute", left: at.x, top: at.y }}
				>
					<NativeHost>
						<DropdownPanel
							items={items}
							onDismiss={close}
							onPick={(item) => {
								close();
								item.onPress();
							}}
							open
							trigger={<Box modifiers={[sized(1, 1)]} />}
						/>
					</NativeHost>
				</View>
			)}
		</View>
	);
}
