import { View } from "react-native";
import { DateField } from "@/ui/DateField";
import { ListRow } from "@/ui/List";

/** A row of an inset group: the label and the system date control at the end. */
export function DateRow({
	label,
	value,
	onChange,
}: {
	label: string;
	value: string;
	onChange: (day: string) => void;
}) {
	return (
		<ListRow>
			<View style={{ flex: 1 }}>
				<DateField label={label} onChange={onChange} value={value} />
			</View>
		</ListRow>
	);
}
