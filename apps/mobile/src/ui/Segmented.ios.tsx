import { Picker, Text } from "@expo/ui/swift-ui";
import {
	accessibilityLabel,
	pickerStyle,
	tag,
} from "@expo/ui/swift-ui/modifiers";
import { NativeHost } from "./NativeHost";
import type { SegmentedProps } from "./types";

/** The system segmented control (SwiftUI Picker, segmented style). */
export function Segmented<T extends string>({
	options,
	value,
	onChange,
	accessibilityLabel: label,
}: SegmentedProps<T>) {
	return (
		<NativeHost>
			<Picker
				modifiers={[pickerStyle("segmented"), accessibilityLabel(label)]}
				onSelectionChange={(selection: T) => onChange(selection)}
				selection={value}
			>
				{options.map((option) => (
					<Text key={option.value} modifiers={[tag(option.value)]}>
						{option.label}
					</Text>
				))}
			</Picker>
		</NativeHost>
	);
}
