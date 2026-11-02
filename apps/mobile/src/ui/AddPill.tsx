import { Pressable } from "react-native";
import { useTheme } from "@/theme";
import { Glyph } from "./Glyph";
import { Text } from "./Text";

/**
 * Provisional primitive: the Add control of an Android tablet (owner
 * decision, 2026-11-02). A 40 high brand pill with a plus and the word, at the
 * top right of the content, the height of the other toolbar buttons. Tablets
 * have no floating button. `label` is the accessibility name ("Add expense");
 * `text` is the visible word ("Add").
 */
export function AddPill({
	label,
	text,
	onPress,
}: {
	label: string;
	text: string;
	onPress: () => void;
}) {
	const { color, radius, size, space } = useTheme();
	return (
		<Pressable
			accessibilityLabel={label}
			accessibilityRole="button"
			onPress={onPress}
			style={({ pressed }) => ({
				flexDirection: "row",
				alignItems: "center",
				gap: space[2],
				height: space[8] + space[2],
				paddingHorizontal: space[4],
				borderRadius: radius.chip,
				backgroundColor: color.brand,
				opacity: pressed ? 0.9 : 1,
			})}
		>
			<Glyph color={color.brandFg} name="Plus" size={size.menuIcon.phone} />
			<Text
				numberOfLines={1}
				scale="chrome"
				style={{ color: color.brandFg }}
				weight="semibold"
			>
				{text}
			</Text>
		</Pressable>
	);
}
