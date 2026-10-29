import { Pressable, Text, View } from "react-native";
import { useTheme } from "@/theme";

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
	const { color, radius, size, space, type } = useTheme();
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
			<Text
				style={{
					color: color.fg,
					fontSize: type.section.size,
					fontWeight: "600",
					textAlign: "center",
				}}
			>
				{title}
			</Text>
			{detail ? (
				<Text
					style={{
						color: color.fg2,
						fontSize: type.body.size,
						textAlign: "center",
					}}
				>
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
					<Text
						style={{
							color: color.brandFg,
							fontSize: type.body.size,
							fontWeight: "500",
						}}
					>
						{actionLabel}
					</Text>
				</Pressable>
			) : null}
		</View>
	);
}
