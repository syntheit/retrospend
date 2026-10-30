import { View } from "react-native";
import { useTheme } from "@/theme";
import { SwitchRow } from "@/ui/SwitchRow";

/** A switch row as a list row: the switch row inside the group's side padding. */
export function SwitchItem(props: {
	label: string;
	detail?: string;
	value: boolean;
	onChange: (value: boolean) => void;
}) {
	const { space } = useTheme();
	return (
		<View style={{ paddingHorizontal: space[4], paddingVertical: space[2] }}>
			<SwitchRow {...props} />
		</View>
	);
}
