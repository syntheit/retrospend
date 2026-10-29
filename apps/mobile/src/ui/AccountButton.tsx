import { Pressable } from "react-native";
import { useTheme } from "@/theme";
import { Avatar, type Face } from "./Avatar";

/**
 * The account button at the trailing end of the top bar (R28): the person's
 * picture, else their initials on their avatar color, with a 44pt touch
 * target. The face is the whole label, so the button carries it in words.
 */
export function AccountButton({
	face,
	label,
	onPress,
}: {
	face: Face;
	label: string;
	onPress?: () => void;
}) {
	const { size } = useTheme();
	const diameter = size.avatar.default;
	return (
		<Pressable
			accessibilityLabel={label}
			accessibilityRole="button"
			hitSlop={(size.touchMin.phone - diameter) / 2}
			onPress={onPress}
			style={{ width: diameter, height: diameter, borderRadius: diameter / 2 }}
		>
			<Avatar face={face} size="default" />
		</Pressable>
	);
}
