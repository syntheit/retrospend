import { Picker as UniversalPicker } from "@expo/ui";

/** The menu picker on iOS (SwiftUI). Android draws its own, with token colors. */
export function NativeDropdown({
	options,
	value,
	onChange,
}: {
	options: { value: string; label: string }[];
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<UniversalPicker<string>
			appearance="menu"
			onValueChange={onChange}
			selectedValue={value}
		>
			{options.map((option) => (
				<UniversalPicker.Item
					key={option.value}
					label={option.label}
					value={option.value}
				/>
			))}
		</UniversalPicker>
	);
}
