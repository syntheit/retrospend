import {
	FloatingActionButton,
	Icon,
	Text,
	TooltipBox,
} from "@expo/ui/jetpack-compose";
import { semantics } from "@expo/ui/jetpack-compose/modifiers";
import { useTheme } from "@/theme";
import { NativeHost } from "./NativeHost";
import type { AddButtonProps } from "./types";

// The plus as a vector drawable: the native FAB draws it at 24 dp in the
// content color, the way the system does.
const PLUS = require("./plus.xml");

/**
 * The standard Material 3 FAB: 56 dp, 16 dp corners, a 24 dp plus on the
 * brand color, no label. A tap adds at once; there is no menu in front of the
 * composer, whose mode row (Expense, Income, Transfer) picks the kind. The
 * name is the accessibility label and a tooltip on long press. `actions` is
 * the iOS long press, which Android does not have.
 */
export function AddButton({ label, onPress }: AddButtonProps) {
	const { color } = useTheme();
	// A Compose node is not read by TalkBack from its text alone here.
	const describe = [semantics({ contentDescription: label })];

	return (
		<NativeHost>
			<TooltipBox>
				<TooltipBox.PlainTooltip>
					<Text>{label}</Text>
				</TooltipBox.PlainTooltip>
				<FloatingActionButton
					containerColor={color.brand}
					modifiers={describe}
					onClick={onPress}
				>
					<FloatingActionButton.Icon>
						<Icon size={24} source={PLUS} tint={color.brandFg} />
					</FloatingActionButton.Icon>
				</FloatingActionButton>
			</TooltipBox>
		</NativeHost>
	);
}
