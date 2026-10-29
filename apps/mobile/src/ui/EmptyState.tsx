import { Pressable, View } from "react-native";
import { useTheme } from "@/theme";
import { Text } from "./Text";

/**
 * One line, at most one action (GUIDELINE §12). No illustration and no
 * icon: the sentence says what is missing.
 */
export function EmptyState({
	title,
	detail,
	actionLabel,
	onAction,
}: {
	title: string;
	detail?: string;
	actionLabel?: string;
	onAction?: () => void;
}) {
	const { color, radius, size, space } = useTheme();
	return (
		<View
			// One stop for the words; with an action, each is its own stop, or
			// VoiceOver could not reach the button.
			accessible={!(actionLabel && onAction)}
			style={{
				alignItems: "center",
				gap: space[2],
				paddingVertical: space[8],
				paddingHorizontal: space[4],
			}}
		>
			<Text style={{ textAlign: "center" }} variant="section">
				{title}
			</Text>
			{detail ? (
				<Text style={{ textAlign: "center" }} tone="fg2">
					{detail}
				</Text>
			) : null}
			{actionLabel && onAction ? (
				<Pressable
					accessibilityRole="button"
					onPress={onAction}
					style={{
						minHeight: size.touchMin.phone,
						justifyContent: "center",
						paddingHorizontal: space[4],
						borderRadius: radius.ctl,
						backgroundColor: color.brand,
					}}
				>
					<Text style={{ color: color.brandFg }} weight="medium">
						{actionLabel}
					</Text>
				</Pressable>
			) : null}
		</View>
	);
}
