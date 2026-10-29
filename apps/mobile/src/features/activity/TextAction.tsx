import { Pressable } from "react-native";
import { useTheme } from "@/theme";
import { Text } from "@/ui/Text";

/**
 * A text action at the end of a row (Select, Categorize, Delete, Done), at
 * the 44pt touch minimum. It is plain React Native text rather than a hosted
 * system button because a hosted control does not follow its row when the row
 * is moved over a native header.
 */
export function TextAction({
	label,
	onPress,
	disabled,
}: {
	label: string;
	onPress: () => void;
	disabled?: boolean;
}) {
	const { color, size, space } = useTheme();
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityState={{ disabled: !!disabled }}
			disabled={disabled}
			onPress={onPress}
			style={({ pressed }) => ({
				minHeight: size.touchMin.phone,
				justifyContent: "center",
				paddingHorizontal: space[2],
				opacity: pressed || disabled ? 0.5 : 1,
			})}
		>
			<Text style={{ color: color.brand }} weight="medium">
				{label}
			</Text>
		</Pressable>
	);
}
