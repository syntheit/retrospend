import { FieldGroup, Row, Spacer, Switch, Text } from "@expo/ui";
import type { ReactNode } from "react";
import { useTheme } from "@/theme";
import { FormFrame, FormMenu, useSectionModifiers } from "./FormChrome";

// The settings form. Expo UI's FieldGroup is the SwiftUI Form on iOS and an
// M3 grouped list (Jetpack Compose) on Android, so the rows, section
// headers, switches and menu pickers are the system's own. The surfaces are
// the tokens on both (FormChrome): the page on bg, the rows on surface.

/** The form fills its screen. */
export function Form({ children }: { children: ReactNode }) {
	return <FormFrame>{children}</FormFrame>;
}

export function FormSection({
	title,
	footer,
	children,
}: {
	title: string;
	/** A sentence under the section, for what the rows cannot say. */
	footer?: string;
	children: ReactNode;
}) {
	const { color, type } = useTheme();
	const modifiers = useSectionModifiers();
	return (
		<FieldGroup.Section modifiers={modifiers} title={title}>
			{children}
			{footer ? (
				<FieldGroup.SectionFooter>
					<Text textStyle={{ color: color.fg2, fontSize: type.small.size }}>
						{footer}
					</Text>
				</FieldGroup.SectionFooter>
			) : null}
		</FieldGroup.Section>
	);
}

/** A label with its current value at the end in fg-2; a tap opens the editor. */
export function FormValueRow({
	label,
	value,
	onPress,
}: {
	label: string;
	value: string;
	onPress?: () => void;
}) {
	const { color, type } = useTheme();
	return (
		<Row alignment="center" onPress={onPress}>
			<Text textStyle={{ color: color.fg, fontSize: type.body.size }}>
				{label}
			</Text>
			<Spacer flexible />
			<Text
				numberOfLines={1}
				textStyle={{
					color: color.fg2,
					fontSize: type.body.size,
					textAlign: "right",
				}}
			>
				{value}
			</Text>
		</Row>
	);
}

/** A row that does something when tapped (Sign out); destructive ones read in the danger color. */
export function FormActionRow({
	label,
	onPress,
	destructive,
}: {
	label: string;
	onPress: () => void;
	destructive?: boolean;
}) {
	const { color, type } = useTheme();
	return (
		<Row alignment="center" onPress={onPress}>
			<Text
				textStyle={{
					color: destructive ? color.danger : color.brand,
					fontSize: type.body.size,
					fontWeight: "500",
				}}
			>
				{label}
			</Text>
		</Row>
	);
}

/** A label with an on/off switch. */
export function FormSwitchRow({
	label,
	value,
	onChange,
	disabled,
}: {
	label: string;
	value: boolean;
	onChange: (value: boolean) => void;
	disabled?: boolean;
}) {
	return (
		<Switch
			disabled={disabled}
			label={label}
			onValueChange={onChange}
			value={value}
		/>
	);
}

/** A label with a menu of choices at the end. */
export function FormPickerRow<T extends string>({
	label,
	options,
	value,
	onChange,
}: {
	label: string;
	options: { value: T; label: string }[];
	value: T;
	onChange: (value: T) => void;
}) {
	const { color, type } = useTheme();
	return (
		<Row alignment="center">
			<Text textStyle={{ color: color.fg, fontSize: type.body.size }}>
				{label}
			</Text>
			<Spacer flexible />
			<FormMenu onChange={onChange} options={options} value={value} />
		</Row>
	);
}
