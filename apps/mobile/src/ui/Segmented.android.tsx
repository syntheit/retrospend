import {
	Host,
	SegmentedButton,
	SingleChoiceSegmentedButtonRow,
	Text,
} from "@expo/ui/jetpack-compose";
import {
	fillMaxWidth,
	semantics,
	weight,
} from "@expo/ui/jetpack-compose/modifiers";
import { useColorScheme } from "react-native";
import { useTheme } from "@/theme";
import { segmentedColors } from "./m3Colors";
import type { SegmentedProps } from "./types";

/**
 * An M3 single-choice segmented button row across the full width, as the
 * iOS segmented control is; the label is what TalkBack reads for the group.
 * Its own host matches the content's height only, so the row can take the
 * width it is given (NativeHost wraps both axes).
 */
export function Segmented<T extends string>({
	options,
	value,
	onChange,
	accessibilityLabel,
}: SegmentedProps<T>) {
	const { color } = useTheme();
	const scheme = useColorScheme();
	const colors = segmentedColors(color);
	return (
		<Host
			colorScheme={scheme === "dark" || scheme === "light" ? scheme : undefined}
			matchContents={{ vertical: true }}
			seedColor={color.brand}
			style={{ alignSelf: "stretch" }}
		>
			<SingleChoiceSegmentedButtonRow
				modifiers={[
					fillMaxWidth(),
					semantics({ contentDescription: accessibilityLabel }),
				]}
			>
				{options.map((option) => (
					<SegmentedButton
						colors={colors}
						key={option.value}
						// Equal shares of the row, as the iOS segments are.
						modifiers={[weight(1)]}
						onClick={() => onChange(option.value)}
						selected={option.value === value}
					>
						<SegmentedButton.Label>
							<Text>{option.label}</Text>
						</SegmentedButton.Label>
					</SegmentedButton>
				))}
			</SingleChoiceSegmentedButtonRow>
		</Host>
	);
}
