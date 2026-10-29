import {
	ExtendedFloatingActionButton,
	FloatingActionButton,
	Text,
} from "@expo/ui/jetpack-compose";
import { semantics } from "@expo/ui/jetpack-compose/modifiers";
import { useTheme } from "@/theme";
import { NativeHost } from "./NativeHost";
import type { AddButtonProps } from "./types";

/**
 * The Material 3 extended FAB ("Add expense"), shrinking to the plus when the
 * list scrolls. A tap adds at once; there is no menu in front of the
 * composer, whose mode row (Expense, Income, Transfer) picks the kind.
 * `actions` is the iOS long press, which Android does not have.
 */
export function AddButton({ label, onPress, expanded = true }: AddButtonProps) {
	const { color } = useTheme();
	// A Compose node is not read by TalkBack from its text alone here.
	const describe = [semantics({ contentDescription: label })];

	const fab = expanded ? (
		<ExtendedFloatingActionButton
			containerColor={color.brand}
			expanded
			modifiers={describe}
			onClick={onPress}
		>
			<ExtendedFloatingActionButton.Text>
				<Text color={color.brandFg}>{label}</Text>
			</ExtendedFloatingActionButton.Text>
		</ExtendedFloatingActionButton>
	) : (
		<FloatingActionButton
			containerColor={color.brand}
			modifiers={describe}
			onClick={onPress}
		>
			<FloatingActionButton.Icon>
				<Text color={color.brandFg}>+</Text>
			</FloatingActionButton.Icon>
		</FloatingActionButton>
	);

	return <NativeHost>{fab}</NativeHost>;
}
