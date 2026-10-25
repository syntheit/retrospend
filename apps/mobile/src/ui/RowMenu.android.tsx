import { useState } from "react";
import { Pressable, Text } from "react-native";
import { useTheme } from "@/theme";
import { Sheet } from "./Sheet";
import type { RowMenuProps } from "./types";

/**
 * The long-press twin of a row's swipe actions: an M3 modal bottom sheet
 * listing them (the Material pattern for row actions on touch).
 */
export function RowMenu({ title, items, children, onPress }: RowMenuProps) {
	const { color, size, space, type } = useTheme();
	const [open, setOpen] = useState(false);
	return (
		<>
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
				onLongPress={() => setOpen(true)}
				onPress={onPress}
			>
				{children}
			</Pressable>
			<Sheet onClose={() => setOpen(false)} title={title} visible={open}>
				{items.map((item) => (
					<Pressable
						accessibilityRole="button"
						key={item.id}
						onPress={() => {
							setOpen(false);
							item.onPress();
						}}
						style={{
							minHeight: size.touchMin.phone,
							justifyContent: "center",
							paddingVertical: space[2],
						}}
					>
						<Text
							style={{
								color: item.destructive ? color.danger : color.fg,
								fontSize: type.section.size,
							}}
						>
							{item.label}
						</Text>
					</Pressable>
				))}
			</Sheet>
		</>
	);
}
