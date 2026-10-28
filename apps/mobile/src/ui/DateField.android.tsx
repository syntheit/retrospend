import { DatePickerDialog, Text, TextButton } from "@expo/ui/jetpack-compose";
import { semantics } from "@expo/ui/jetpack-compose/modifiers";
import { dayKey } from "@retrospend/domain/time-zone";
import { useState } from "react";
import { Text as RNText, View } from "react-native";
import { useFormatter } from "use-intl";
import { useTranslations } from "use-intl";
import { dayOfPicker, pickerDate } from "@/features/entry/dates";
import { useTheme } from "@/theme";
import { NativeHost } from "./NativeHost";
import type { DateFieldProps } from "./types";

/**
 * A labeled row whose day opens the Material 3 date picker dialog. The
 * dialog counts days from UTC midnight, so the day goes in and out on the
 * UTC clock.
 */
export function DateField({
	label,
	value,
	onChange,
	placeholder,
}: DateFieldProps) {
	const { color, size, space, type } = useTheme();
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
			<RNText style={{ color: color.fg, fontSize: type.body.size }}>
				{label}
			</RNText>
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
					/>
				</NativeHost>
			) : null}
		</View>
	);
}
