import { Pressable } from "react-native";
import { useTheme } from "@/theme";
import { Text } from "./Text";

/**
 * The one text button: words in the brand color, no box, at the 44pt touch
 * minimum. For an action at the end of a row (Select, Done, Try again), a
 * link on its own line (Show more) or a quiet link in a footer. It is plain
 * React Native rather than a hosted system button because a hosted control
 * does not follow its row when the row is moved over a native header.
 *
 * `inset` lines the words up with list rows (16 from the edge); `small` is
 * the 13 point size for a footer. `danger` is only for discarding something
 * beside a brand action (Try again, Discard). A pressed or disabled action
 * changes color, not opacity.
 */
export function TextAction({
	label,
	onPress,
	disabled,
	tone = "brand",
	small,
	inset,
	accessibilityLabel,
	link,
	testID,
}: {
	label: string;
	onPress: () => void;
	disabled?: boolean;
	tone?: "brand" | "danger";
	small?: boolean;
	inset?: boolean;
	/** What a screen reader says when it differs from the text. */
	accessibilityLabel?: string;
	/** Opens a page outside the app: read out as a link, not a button. */
	link?: boolean;
	/** The stable id the Maestro flows find it by (src/lib/testIds.ts). */
	testID?: string;
}) {
	const { color, radius, size, space } = useTheme();
	return (
		<Pressable
			accessibilityLabel={accessibilityLabel}
			accessibilityRole={link ? "link" : "button"}
			accessibilityState={{ disabled: !!disabled }}
			disabled={disabled}
			onPress={onPress}
			testID={testID}
			style={({ pressed }) => ({
				minHeight: size.touchMin.phone,
				justifyContent: "center",
				paddingHorizontal: inset ? space[4] : space[2],
				borderRadius: radius.ctl,
				backgroundColor: pressed ? color.raised : "transparent",
			})}
		>
			<Text
				style={{
					color: disabled
						? color.fg3
						: tone === "danger"
							? color.danger
							: color.brand,
				}}
				variant={small ? "small" : "body"}
				weight="medium"
			>
				{label}
			</Text>
		</Pressable>
	);
}
