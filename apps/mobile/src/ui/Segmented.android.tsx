import {
	SegmentedButton,
	SingleChoiceSegmentedButtonRow,
	Text,
} from "@expo/ui/jetpack-compose";
import { NativeHost } from "./NativeHost";
import type { SegmentedProps } from "./types";

/** An M3 single-choice segmented button row. */
export function Segmented<T extends string>({
	options,
	value,
	onChange,
}: SegmentedProps<T>) {
	return (
		<NativeHost>
			<SingleChoiceSegmentedButtonRow>
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
