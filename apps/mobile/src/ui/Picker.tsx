import { Picker as UniversalPicker } from "@expo/ui";
import { Platform } from "react-native";
import { useTheme } from "@/theme";
import { NativeHost } from "./NativeHost";

export interface PickerOption<T extends string> {
	value: T;
	label: string;
}

/**
 * A single choice from a list: the SwiftUI menu picker on iOS (a wheel for
 * short pickers like a date part) and the M3 exposed dropdown on Android.
 * The value reads in fg-2 on iOS, as the settings mockup has it, not in the
 * brand tint that marks an action.
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
	const { color } = useTheme();
	return (
		<NativeHost tint={Platform.OS === "ios" ? color.fg2 : undefined}>
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
