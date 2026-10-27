import { Button as SwiftButton, Text } from "@expo/ui/swift-ui";
import {
	accessibilityLabel as a11yLabel,
	buttonStyle,
	disabled as disabledModifier,
	foregroundStyle,
	tint,
} from "@expo/ui/swift-ui/modifiers";
import { useTheme } from "@/theme";
import { NativeHost } from "./NativeHost";
import type { ButtonProps } from "./types";

/**
 * The SwiftUI style for each variant. Filled is borderedProminent: a solid
 * fill in the tint. The glass styles (glass, glassProminent) are for chrome
 * only and lighten the tint, which is what made the label unreadable (R17).
 */
export const BUTTON_STYLE = {
	filled: "borderedProminent",
	outlined: "bordered",
	text: "plain",
} as const;

/**
 * A SwiftUI button on the brand tint. The label color is set to the token
 * that sits on the brand fill: the system's own white is unreadable on the
 * pale brand of the dark theme.
 */
export function Button({
	label,
	accessibilityLabel,
	onPress,
	variant = "filled",
	disabled,
}: ButtonProps) {
	const { color } = useTheme();
	return (
		<NativeHost>
			<SwiftButton
				modifiers={[
					buttonStyle(BUTTON_STYLE[variant]),
					tint(color.brand),
					...(accessibilityLabel ? [a11yLabel(accessibilityLabel)] : []),
					...(disabled ? [disabledModifier(true)] : []),
				]}
				onPress={onPress}
			>
				<Text
					modifiers={[
						foregroundStyle(variant === "filled" ? color.brandFg : color.brand),
					]}
				>
					{label}
				</Text>
			</SwiftButton>
		</NativeHost>
	);
}
