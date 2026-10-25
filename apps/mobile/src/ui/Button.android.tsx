import { Button as UniversalButton } from "@expo/ui";
import { NativeHost } from "./NativeHost";
import type { ButtonProps } from "./types";

/** An M3 button; its colors come from the brand seed on the host. */
export function Button({
	label,
	onPress,
	variant = "filled",
	disabled,
}: ButtonProps) {
	return (
		<NativeHost>
			<UniversalButton
				disabled={disabled}
				label={label}
				onPress={onPress}
				variant={variant}
			/>
		</NativeHost>
	);
}
