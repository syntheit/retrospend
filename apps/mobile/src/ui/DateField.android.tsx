import { DatePickerDialog, Text, TextButton } from "@expo/ui/jetpack-compose";
import { semantics } from "@expo/ui/jetpack-compose/modifiers";
import { dayKey } from "@retrospend/domain/time-zone";
import { useState } from "react";
import { View } from "react-native";
import { useFormatter, useTranslations } from "use-intl";
import { dayOfPicker, pickerDate } from "@/features/entry/dates";
import { useTheme } from "@/theme";
import { DateQuickDays } from "./DateQuickDays";
import { NativeHost } from "./NativeHost";
import { Text as AppText } from "./Text";
import type { DateFieldProps } from "./types";

/**
 * A labeled row whose day opens the Material 3 date picker dialog. The
 * dialog counts days from UTC midnight, so the day goes in and out on the
 * UTC clock.
 */
function DateRow({
	label,
	value,
	onChange,
	placeholder,
	minimum,
}: DateFieldProps) {
	const { color, size, space } = useTheme();
	const t = useTranslations("mobile.pickers");
	const format = useFormatter();
	const [open, setOpen] = useState(false);
	const shown = value
		? format.dateTime(pickerDate(value, "local"), { dateStyle: "medium" })
		: (placeholder ?? t("pickDate"));
	return (
		<View
			style={{
				minHeight: size.touchMin.phone,
				flexDirection: "row",
				alignItems: "center",
				justifyContent: "space-between",
				gap: space[3],
			}}
		>
			<AppText>{label}</AppText>
			<NativeHost>
				<TextButton
					modifiers={[semantics({ contentDescription: `${label}, ${shown}` })]}
					onClick={() => setOpen(true)}
				>
					<Text>{shown}</Text>
				</TextButton>
			</NativeHost>
			{open ? (
				<NativeHost>
					<DatePickerDialog
						color={color.brand}
						initialDate={pickerDate(
							value || dayKey(new Date()),
							"utc",
						).toISOString()}
						onDateSelected={(date) => {
							setOpen(false);
							onChange(dayOfPicker(date, "utc"));
						}}
						onDismissRequest={() => setOpen(false)}
						selectableDates={
							minimum ? { start: pickerDate(minimum, "utc") } : undefined
						}
					/>
				</NativeHost>
			) : null}
		</View>
	);
}

/** The row, and with `quick` the Today and Yesterday chips under it. */
export function DateField(props: DateFieldProps) {
	const { space } = useTheme();
	if (!props.quick) return <DateRow {...props} />;
	return (
		<View style={{ gap: space[1] }}>
			<DateRow {...props} />
			<DateQuickDays
				onChange={props.onChange}
				today={props.today}
				value={props.value}
			/>
		</View>
	);
}
