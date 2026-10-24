import { Pressable, Text } from "react-native";
import { useTheme } from "@/theme";

/**
 * The account button at the trailing end of the top bar (R28): the person's
 * initials on the avatar color, with a 44pt touch target.
 */
export function AccountButton({
	initials,
	label,
	onPress,
}: {
	initials: string;
	label: string;
	onPress?: () => void;
}) {
	const { color, size, type } = useTheme();
	const diameter = size.avatar.default;
	return (
		<Pressable
			accessibilityLabel={label}
			accessibilityRole="button"
			hitSlop={(size.touchMin.phone - diameter) / 2}
			onPress={onPress}
			style={{
				width: diameter,
				height: diameter,
				borderRadius: diameter / 2,
				backgroundColor: color.avatar1,
				alignItems: "center",
				justifyContent: "center",
			}}
		>
			<Text
				style={{
					color: color.avatarFg,
					fontSize: type.small.size,
					fontWeight: "600",
				}}
			>
				{initials}
			</Text>
		</Pressable>
	);
}
