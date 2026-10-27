import {
	Button as ComposeButton,
	OutlinedButton,
	Text,
	TextButton,
} from "@expo/ui/jetpack-compose";
import { useTheme } from "@/theme";
import { NativeHost } from "./NativeHost";
import type { ButtonProps } from "./types";

/**
 * An M3 button with the token colors set outright: the filled one is the
 * brand fill with the brand foreground on it (the same pair the contrast
 * test checks), not a color Material derives from the seed.
 */
export function Button({
	label,
	onPress,
	variant = "filled",
	disabled,
}: ButtonProps) {
	const { color } = useTheme();
	const Component =
		variant === "filled"
			? ComposeButton
			: variant === "outlined"
				? OutlinedButton
				: TextButton;
	return (
		<NativeHost>
			<Component
				colors={
					variant === "filled"
						? { containerColor: color.brand, contentColor: color.brandFg }
						: { contentColor: color.brand }
				}
				enabled={!disabled}
				onClick={disabled ? undefined : onPress}
			>
				<Text>{label}</Text>
			</Component>
		</NativeHost>
	);
}
