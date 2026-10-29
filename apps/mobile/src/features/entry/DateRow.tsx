import type { ReactNode } from "react";
import { View } from "react-native";
import { useTheme } from "@/theme";
import { DateField } from "@/ui/DateField";

/**
 * A row of an inset group that holds a control of its own (the date picker,
 * a switch, the rate line). It is a plain view, not a list row: a list row is
 * one accessibility element, which would hide the control inside it from a
 * screen reader.
 */
export function GroupItem({ children }: { children: ReactNode }) {
	const { size, space } = useTheme();
	return (
		<View
			style={{
				minHeight: size.row.phone,
				justifyContent: "center",
				paddingHorizontal: space[4],
				paddingVertical: space[1],
			}}
		>
			{children}
		</View>
	);
}

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
		<GroupItem>
			<DateField label={label} onChange={onChange} value={value} />
		</GroupItem>
	);
}
