import {
	SegmentedButton,
	SingleChoiceSegmentedButtonRow,
	Text,
} from "@expo/ui/jetpack-compose";
import { semantics } from "@expo/ui/jetpack-compose/modifiers";
import { NativeHost } from "./NativeHost";
import type { SegmentedProps } from "./types";

/** An M3 single-choice segmented button row; the label is what TalkBack reads for the group. */
export function Segmented<T extends string>({
	options,
	value,
	onChange,
	accessibilityLabel,
}: SegmentedProps<T>) {
	return (
		<NativeHost>
			<SingleChoiceSegmentedButtonRow
				modifiers={[semantics({ contentDescription: accessibilityLabel })]}
			>
				{options.map((option) => (
					<SegmentedButton
						key={option.value}
						onClick={() => onChange(option.value)}
						selected={option.value === value}
					>
						<SegmentedButton.Label>
							<Text>{option.label}</Text>
						</SegmentedButton.Label>
					</SegmentedButton>
				))}
			</SingleChoiceSegmentedButtonRow>
		</NativeHost>
	);
}
