import { View } from "react-native";
import { useTheme } from "@/theme";
import { Button } from "@/ui/Button";

export interface PersonAction {
	id: string;
	label: string;
	onPress: () => void;
	/** The one filled action (Settle up). */
	primary?: boolean;
}

/**
 * The actions on a person, as buttons in one row: Settle up (filled), Remind
 * and Expense (outlined). They share one height, as buttons do.
 */
export function PersonActions({ actions }: { actions: PersonAction[] }) {
	const { size, space } = useTheme();
	if (actions.length === 0) return null;
	return (
		<View
			style={{
				flexDirection: "row",
				flexWrap: "wrap",
				alignItems: "center",
				gap: space[2],
				paddingHorizontal: size.gutter.phone,
			}}
		>
			{actions.map((action) => (
				<Button
					key={action.id}
					label={action.label}
					onPress={action.onPress}
					variant={action.primary ? "filled" : "outlined"}
				/>
			))}
		</View>
	);
}
