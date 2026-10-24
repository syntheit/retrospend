import { Picker as UniversalPicker } from "@expo/ui";
import { NativeHost } from "./NativeHost";

export interface PickerOption<T extends string> {
	value: T;
	label: string;
}

/**
 * A single choice from a list: the SwiftUI menu picker on iOS (a wheel for
 * short pickers like a date part) and the M3 exposed dropdown on Android.
 */
export function Picker<T extends string>({
	options,
	value,
	onChange,
	appearance = "menu",
}: {
	options: PickerOption<T>[];
	value: T;
	onChange: (value: T) => void;
	appearance?: "menu" | "wheel";
}) {
	return (
		<NativeHost>
			<UniversalPicker<string>
				appearance={appearance}
				onValueChange={(next) => onChange(next as T)}
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
		</NativeHost>
	);
}
