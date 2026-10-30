import { useWindowDimensions, View } from "react-native";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";
import type { ButtonIcon } from "@/ui/types";

/**
 * From this text size up, three labels no longer fit one row at the chrome
 * cap without breaking a word, so the actions stack.
 */
export const STACK_FROM_SCALE = 1.15;

export interface PersonAction {
	id: string;
	label: string;
	onPress: () => void;
	/** The glyph before the label (banknote, bell, plus). */
	icon?: ButtonIcon;
	/** The one filled action (Settle up). */
	primary?: boolean;
}

/**
 * The actions on a person, as equal columns in one row: Settle up (filled),
 * Remind and Expense (outlined), each with its glyph. They share one height
 * and one width, as the mockup's three columns do.
 */
export function PersonActions({ actions }: { actions: PersonAction[] }) {
	const { size, space } = useTheme();
	const { fontScale } = useWindowDimensions();
	const stacked = fontScale >= STACK_FROM_SCALE;
	if (actions.length === 0) return null;
	return (
		<View
			style={{
				flexDirection: stacked ? "column" : "row",
				alignItems: stacked ? "stretch" : "flex-start",
				gap: space[2],
				paddingHorizontal: size.gutter.phone,
			}}
		>
			{actions.map((action) => (
				<View key={action.id} style={stacked ? undefined : { flex: 1 }}>
					<Button
						fill
						icon={action.icon}
						label={action.label}
						onPress={action.onPress}
						variant={action.primary ? "filled" : "outlined"}
					/>
				</View>
			))}
		</View>
	);
}
