import { DateField } from "@/ui/DateField";
import { GroupItem } from "@/ui/List";

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
