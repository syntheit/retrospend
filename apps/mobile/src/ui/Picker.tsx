import { Picker as UniversalPicker } from "@expo/ui";
import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { useTheme } from "@/theme";
import { Chip } from "./Chip";
import { ListRow, NavEnd } from "./List";
import { NativeHost } from "./NativeHost";
import { Sheet } from "./Sheet";
import { Text } from "./Text";
import { ValueMenu } from "./ValueMenu";

export interface PickerOption<T extends string> {
	value: T;
	label: string;
}

/**
 * A single choice from a list: the SwiftUI menu picker on iOS and the M3
 * exposed dropdown on Android. The value reads in fg-2 on iOS, as the
 * settings mockup has it, not in the brand tint that marks an action. A short
 * run of numbers (a day of the month) is a WheelField instead.
 */
export function Picker<T extends string>({
	options,
	value,
	onChange,
}: {
	options: PickerOption<T>[];
	value: T;
	onChange: (value: T) => void;
}) {
	const { color } = useTheme();
	return (
		<NativeHost tint={Platform.OS === "ios" ? color.fg2 : undefined}>
			<UniversalPicker<string>
				appearance="menu"
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

/**
 * Android's value row for a choice from a list: the label (and what it means
 * under it) on the left, the value and a chevron in fg-2 on the right, and a
 * press opens an M3 dropdown under the value, as Currency opens its picker.
 * The M3 exposed dropdown field squeezed the label to a third of the row.
 */
export function PickerValueRow<T extends string>({
	label,
	sub,
	options,
	value,
	onChange,
}: {
	label: string;
	sub?: string;
	options: PickerOption<T>[];
	value: T;
	onChange: (value: T) => void;
}) {
	const [open, setOpen] = useState(false);
	const shown = options.find((o) => o.value === value)?.label ?? value;
	return (
		<ListRow
			accessibilityLabel={`${label}, ${shown}`}
			end={
				<ValueMenu
					items={options.map((option) => ({
						id: option.value,
						label: option.label,
						onPress: () => onChange(option.value),
					}))}
					open={open}
					setOpen={setOpen}
				>
					<NavEnd value={shown} />
				</ValueMenu>
			}
			onPress={() => setOpen(true)}
			sub={sub}
			title={<Text weight="normal">{label}</Text>}
		/>
	);
}

/** The system wheel's own height, seven rows; stretched or squeezed it shows four. */
const WHEEL_HEIGHT = 216;

/**
 * The system wheel in a sheet at the medium detent, behind a value. It keeps
 * its own pick while the wheel turns and hands it over when the sheet closes
 * (Done or a swipe down), so a setting saves once and not at every number it
 * passes.
 */
function WheelSheet<T extends string>({
	visible,
	onClose,
	title,
	options,
	value,
	onChange,
}: {
	visible: boolean;
	onClose: () => void;
	title: string;
	options: PickerOption<T>[];
	value: T;
	onChange: (value: T) => void;
}) {
	const { color } = useTheme();
	const [draft, setDraft] = useState(value);
	useEffect(() => {
		if (visible) setDraft(value);
	}, [visible, value]);
	return (
		<Sheet
			detents={["medium"]}
			dismiss="done"
			onClose={() => {
				if (draft !== value) onChange(draft);
				onClose();
			}}
			title={title}
			visible={visible}
		>
			<View style={{ flex: 1, minHeight: 0, justifyContent: "center" }}>
				<NativeHost
					matchContents={false}
					style={{ height: WHEEL_HEIGHT, alignSelf: "stretch" }}
					tint={color.fg2}
				>
					<UniversalPicker<string>
						appearance="wheel"
						onValueChange={(next) => setDraft(next as T)}
						selectedValue={draft}
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
			</View>
		</Sheet>
	);
}

/**
 * A choice from a short run of numbers (the day of the month, 1 to 28), one
 * control for every place that asks. On iOS the value opens the system wheel
 * in a sheet; the wheel is never drawn inline, where it is a 200 point drum
 * in the middle of a form. Android has no wheel, so the row opens an M3
 * dropdown of the numbers (Material 3) and the chip keeps the M3 field.
 * - `row`: a value row in an inset group, the label on the left and the
 *   value and chevron in fg-2 on the right.
 * - `chip`: a trigger chip under a field label in a flat form.
 */
export function WheelField<T extends string>({
	variant = "row",
	label,
	options,
	value,
	onChange,
}: {
	variant?: "row" | "chip";
	/** What is being chosen ("Month start"), the sheet's title and spoken before the value. */
	label: string;
	options: PickerOption<T>[];
	value: T;
	onChange: (value: T) => void;
}) {
	const [open, setOpen] = useState(false);
	const shown = options.find((o) => o.value === value)?.label ?? value;
	const spoken = `${label}, ${shown}`;
	const dropdown = Platform.OS !== "ios";
	if (dropdown && variant === "chip") {
		return <Picker onChange={onChange} options={options} value={value} />;
	}
	if (dropdown) {
		return (
			<PickerValueRow
				label={label}
				onChange={onChange}
				options={options}
				value={value}
			/>
		);
	}
	return (
		<>
			{variant === "chip" ? (
				<Chip
					accessibilityLabel={spoken}
					label={shown}
					onPress={() => setOpen(true)}
					variant="trigger"
				/>
			) : (
				<ListRow
					accessibilityLabel={spoken}
					end={<NavEnd value={shown} />}
					onPress={() => setOpen(true)}
					title={<Text weight="normal">{label}</Text>}
				/>
			)}
			<WheelSheet
				onChange={onChange}
				onClose={() => setOpen(false)}
				options={options}
				title={label}
				value={value}
				visible={open}
			/>
		</>
	);
}
