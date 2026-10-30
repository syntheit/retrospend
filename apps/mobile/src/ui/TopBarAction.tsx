import { Pressable } from "react-native";
import { useTheme } from "@/theme";
import { Glyph } from "./Glyph";
import type { TopBarAction as Action } from "./types";

/**
 * One icon-only page action in the top bar (Add person, New project): a bare
 * glyph with the 44 point touch target, labeled for screen readers. It sits
 * before the overflow mark and the account button, never as a filled button.
 */
export function TopBarAction({ icon, label, onPress }: Action) {
	const { color, size } = useTheme();
	return (
		<Pressable
			accessibilityLabel={label}
			accessibilityRole="button"
			onPress={onPress}
			style={({ pressed }) => ({
				width: size.touchMin.phone,
				height: size.touchMin.phone,
				borderRadius: size.touchMin.phone / 2,
				alignItems: "center",
				justifyContent: "center",
				backgroundColor: pressed ? color.raised : "transparent",
			})}
		>
			<Glyph color={color.fg} name={icon} size={size.icon.phone} />
		</Pressable>
	);
}
