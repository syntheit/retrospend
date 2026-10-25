import { Button as SwiftButton, Text } from "@expo/ui/swift-ui";
import {
	buttonStyle,
	disabled as disabledModifier,
	foregroundStyle,
	tint,
} from "@expo/ui/swift-ui/modifiers";
import { useTheme } from "@/theme";
import { NativeHost } from "./NativeHost";
import type { ButtonProps } from "./types";

/**
 * A SwiftUI button on the brand tint. The label color is set to the token
 * that sits on the brand fill: the system's own white is unreadable on the
 * pale brand of the dark theme.
 */
export function Button({
	label,
	onPress,
	variant = "filled",
	disabled,
}: ButtonProps) {
	const { color } = useTheme();
	const filled = variant === "filled";
	return (
		<NativeHost>
			<SwiftButton
				modifiers={[
					buttonStyle(filled ? "borderedProminent" : "bordered"),
					tint(color.brand),
					...(disabled ? [disabledModifier(true)] : []),
				]}
				onPress={onPress}
			>
				<Text
					modifiers={[foregroundStyle(filled ? color.brandFg : color.brand)]}
				>
					{label}
				</Text>
			</SwiftButton>
		</NativeHost>
	);
}
