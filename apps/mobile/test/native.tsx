import { Pressable } from "react-native";

// Stand-ins for the native widgets that have no JS to press in a test (not a
// test itself). A file opts in per module:
//   jest.mock("@/ui/Sheet", () => require("../../../test/native").sheetMock);
// Each is a plain pressable or a pass-through, so the screen above it still
// renders for real.

type Props = Record<string, unknown>;

/** The sheet shows its body and footer while it is visible. */
export const sheetMock = {
	Sheet: ({
		visible,
		children,
		footer,
	}: {
		visible?: boolean;
		children?: unknown;
		footer?: unknown;
	}) => (visible === false ? null : ([children, footer] as never)),
	useSheetBodySize: () => ({}),
};

/** The button as a pressable with its label. */
export const buttonMock = {
	Button: ({ label, onPress, disabled }: Props) => (
		<Pressable
			accessibilityLabel={label as string}
			accessibilityState={{ disabled: Boolean(disabled) }}
			onPress={disabled ? undefined : (onPress as () => void)}
		/>
	),
};

/** The system menu's items as plain buttons. */
export const menuMock = {
	Menu: ({
		items,
	}: {
		items: { id: string; label: string; onPress: () => void }[];
	}) =>
		items.map((item) => (
			<Pressable
				accessibilityLabel={item.label}
				key={item.id}
				onPress={item.onPress}
			/>
		)),
};

/** The picker sheet's rows as plain buttons labeled "pick <row>". */
export const pickerSheetMock = {
	PickerSheet: ({
		visible,
		groups,
		onSelect,
	}: {
		visible?: boolean;
		groups: { rows: { id: string; label: string }[] }[];
		onSelect: (id: string) => void;
	}) =>
		visible
			? groups.flatMap((g) =>
					g.rows.map((r) => (
						<Pressable
							accessibilityLabel={`pick ${r.label}`}
							key={r.id}
							onPress={() => onSelect(r.id)}
						/>
					)),
				)
			: null,
};

/** Segmented controls as one pressable per option. */
export const segmentedMock = {
	Segmented: ({
		options,
		onChange,
	}: {
		options: { value: string; label: string }[];
		onChange: (value: string) => void;
	}) =>
		options.map((o) => (
			<Pressable
				accessibilityLabel={o.label}
				key={o.value}
				onPress={() => onChange(o.value)}
			/>
		)),
};

/** A picker that renders nothing: the test uses chips and keys instead. */
export const currencyPickerMock = { CurrencyPicker: () => null };
export const categoryPickerMock = { CategoryPicker: () => null };
