import {
	Button as ComposeButton,
	OutlinedButton,
	Text,
	TextButton,
} from "@expo/ui/jetpack-compose";
import { height, semantics } from "@expo/ui/jetpack-compose/modifiers";
import { useTheme } from "@/theme";
import { NativeHost } from "./NativeHost";
import type { ButtonProps } from "./types";

/**
 * An M3 button with the token colors set outright: filled is the brand fill
 * with the brand foreground on it, danger the danger fill with its own
 * foreground (the pairs the contrast test checks), not a color Material
 * derives from the seed. Small is the 28 dp control with 13 point text.
 */
export function Button({
	label,
	accessibilityLabel,
	onPress,
	variant = "filled",
	size = "regular",
	disabled,
}: ButtonProps) {
	const { color, size: sizes, space, type } = useTheme();
	const Component =
		variant === "filled" || variant === "danger"
			? ComposeButton
			: variant === "outlined"
				? OutlinedButton
				: TextButton;
	const small = size === "small";
	return (
		<NativeHost>
			<Component
				colors={
					variant === "filled"
						? { containerColor: color.brand, contentColor: color.brandFg }
						: variant === "danger"
							? { containerColor: color.danger, contentColor: color.dangerFg }
							: { contentColor: color.brand }
				}
				contentPadding={
					small
						? { start: space[3], end: space[3], top: 0, bottom: 0 }
						: undefined
				}
				enabled={!disabled}
				modifiers={[
					...(small ? [height(sizes.ctlSm.phone)] : []),
					...(accessibilityLabel
						? [semantics({ contentDescription: accessibilityLabel })]
						: []),
				]}
				onClick={disabled ? undefined : onPress}
			>
				<Text style={small ? { fontSize: type.small.size } : undefined}>
					{label}
				</Text>
			</Component>
		</NativeHost>
	);
}
