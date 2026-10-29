import { Button as SwiftButton, Text } from "@expo/ui/swift-ui";
import {
	accessibilityLabel as a11yLabel,
	buttonStyle,
	controlSize,
	disabled as disabledModifier,
	foregroundStyle,
	tint,
} from "@expo/ui/swift-ui/modifiers";
import { useTheme } from "@/theme";
import { NativeHost } from "./NativeHost";
import type { ButtonProps } from "./types";

/**
 * The SwiftUI style for each variant. Filled and danger are
 * borderedProminent: a solid fill in the tint. The glass styles (glass,
 * glassProminent) are for chrome only and lighten the tint, which is what
 * made the label unreadable (R17).
 */
export const BUTTON_STYLE = {
	filled: "borderedProminent",
	outlined: "bordered",
	text: "plain",
	danger: "borderedProminent",
} as const;

/**
 * A SwiftUI button. Filled sits on the brand tint, danger on the danger
 * tint; each label takes the token that reads on its fill, since the
 * system's own white is unreadable on the pale brand of the dark theme.
 * Small is the system's small control size.
 */
export function Button({
	label,
	accessibilityLabel,
	onPress,
	variant = "filled",
	size = "regular",
	disabled,
}: ButtonProps) {
	const { color } = useTheme();
	const fill = variant === "danger" ? color.danger : color.brand;
	const ink =
		variant === "filled"
			? color.brandFg
			: variant === "danger"
				? color.dangerFg
				: color.brand;
	return (
		<NativeHost>
			<SwiftButton
				modifiers={[
					buttonStyle(BUTTON_STYLE[variant]),
					tint(fill),
					...(size === "small" ? [controlSize("small")] : []),
					...(accessibilityLabel ? [a11yLabel(accessibilityLabel)] : []),
					...(disabled ? [disabledModifier(true)] : []),
				]}
				onPress={onPress}
			>
				<Text modifiers={[foregroundStyle(ink)]}>{label}</Text>
			</SwiftButton>
		</NativeHost>
	);
}
