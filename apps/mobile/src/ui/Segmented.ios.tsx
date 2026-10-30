import { Host, Picker, Text } from "@expo/ui/swift-ui";
import {
	accessibilityLabel,
	frame,
	pickerStyle,
	tag,
} from "@expo/ui/swift-ui/modifiers";
import { useColorScheme } from "react-native";
import { useTheme } from "@/theme";
import { NativeHost } from "./NativeHost";
import type { SegmentedProps } from "./types";

/**
 * The system segmented control (SwiftUI Picker, segmented style). It is as
 * wide as its labels; `stretch` fills the width it is given, with equal
 * segments (a direction switch, a range, the parts of a page).
 */
export function Segmented<T extends string>({
	options,
	value,
	onChange,
	accessibilityLabel: label,
	stretch,
}: SegmentedProps<T>) {
	const { color } = useTheme();
	const scheme = useColorScheme();
	if (stretch) {
		// A host that matches the height only, so the row can take the width.
		return (
			<Host
				colorScheme={
					scheme === "dark" || scheme === "light" ? scheme : undefined
				}
				matchContents={{ vertical: true }}
				seedColor={color.brand}
				style={{ alignSelf: "stretch" }}
			>
				<Picker
					modifiers={[
						pickerStyle("segmented"),
						frame({ maxWidth: Infinity }),
						accessibilityLabel(label),
					]}
					onSelectionChange={(selection: T) => onChange(selection)}
					selection={value}
				>
					{options.map((option) => (
						<Text key={option.value} modifiers={[tag(option.value)]}>
							{option.label}
						</Text>
					))}
				</Picker>
			</Host>
		);
	}
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
