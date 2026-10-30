import { Host } from "@expo/ui";
import {
	Button as ComposeButton,
	OutlinedButton,
	Text,
	TextButton,
} from "@expo/ui/jetpack-compose";
import {
	fillMaxWidth,
	height,
	semantics,
} from "@expo/ui/jetpack-compose/modifiers";
import { useColorScheme } from "react-native";
import { useTheme } from "@/theme";
import { NativeHost } from "./NativeHost";
import { useChromeTextSize } from "./Text";
import type { ButtonProps } from "./types";

/**
 * An M3 button with the token colors set outright: filled is the brand fill
 * with the brand foreground on it, danger the danger fill with its own
 * foreground (the pairs the contrast test checks), not a color Material
 * derives from the seed. Outlined is the kit secondary (surface, fg text, the
 * M3 outline); dangerText is the bare danger-text ghost; the icon prop is for
 * the SwiftUI buttons only. Small is the 28 dp control with 13 point text.
 * The label grows with the user's text size up to the chrome cap, as the iOS
 * button's does (useChromeTextSize takes the system's uncapped sp scaling back).
 */
export function Button({
	label,
	accessibilityLabel,
	onPress,
	variant = "filled",
	size = "regular",
	disabled,
	fill,
}: ButtonProps) {
	const scheme = useColorScheme();
	const { color, size: sizes, space, type } = useTheme();
	const Component =
		variant === "filled" || variant === "danger"
			? ComposeButton
			: variant === "outlined"
				? OutlinedButton
				: TextButton;
	const small = size === "small";
	const labelSize = useChromeTextSize(small ? type.small.size : type.body.size);
	const button = (
		<Component
			colors={
				variant === "filled"
					? { containerColor: color.brand, contentColor: color.brandFg }
					: variant === "danger"
						? { containerColor: color.danger, contentColor: color.dangerFg }
						: variant === "outlined"
							? { containerColor: color.surface, contentColor: color.fg }
							: variant === "dangerText"
								? { contentColor: color.danger }
								: { contentColor: color.brand }
			}
			contentPadding={
				small
					? { start: space[3], end: space[3], top: 0, bottom: 0 }
					: undefined
			}
			enabled={!disabled}
			modifiers={[
				...(fill ? [fillMaxWidth()] : []),
				...(small ? [height(sizes.ctlSm.phone)] : []),
				...(accessibilityLabel
					? [semantics({ contentDescription: accessibilityLabel })]
					: []),
			]}
			onClick={disabled ? undefined : onPress}
		>
			<Text style={{ fontSize: labelSize }}>{label}</Text>
		</Component>
	);
	if (!fill) return <NativeHost>{button}</NativeHost>;
	// A host that matches the height only, so the button takes the width its
	// row gives it (two equal halves on a card).
	return (
		<Host
			colorScheme={scheme === "dark" || scheme === "light" ? scheme : undefined}
			matchContents={{ vertical: true }}
			seedColor={color.brand}
			style={{ alignSelf: "stretch" }}
		>
			{button}
		</Host>
	);
}
