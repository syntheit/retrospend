import { Button, DatePicker, Text as SwiftText } from "@expo/ui/swift-ui";
import {
	accessibilityLabel as a11yLabel,
	datePickerStyle,
	tint,
} from "@expo/ui/swift-ui/modifiers";
import { dayKey } from "@retrospend/domain/time-zone";
import { View } from "react-native";
import { useTranslations } from "use-intl";
import { dayOfPicker, pickerDate } from "@/features/entry/dates";
import { useTheme } from "@/theme";
import { DateQuickDays } from "./DateQuickDays";
import { NativeHost } from "./NativeHost";
import { Text } from "./Text";
import type { DateFieldProps } from "./types";

/**
 * The system date control (SwiftUI compact DatePicker) at the end of a
 * labeled row. With no day picked it shows a text button that picks today,
 * after which the compact picker takes over.
 */
function DateRow({
	label,
	value,
	onChange,
	placeholder,
	minimum,
}: DateFieldProps) {
	const { color, size, space } = useTheme();
	const tc = useTranslations("mobile.common");
	return (
		<View
			style={{
				minHeight: size.touchMin.phone,
				flexDirection: "row",
				flexWrap: "wrap",
				alignItems: "center",
				justifyContent: "space-between",
				columnGap: space[3],
			}}
		>
			<Text>{label}</Text>
			<NativeHost>
				{value ? (
					<DatePicker
						displayedComponents={["date"]}
						modifiers={[
							datePickerStyle("compact"),
							tint(color.brand),
							a11yLabel(label),
						]}
						onDateChange={(date) => onChange(dayOfPicker(date, "local"))}
						range={
							minimum ? { start: pickerDate(minimum, "local") } : undefined
						}
						selection={pickerDate(value, "local")}
					/>
				) : (
					<Button
						modifiers={[tint(color.brand), a11yLabel(label)]}
						onPress={() => onChange(dayKey(new Date()))}
					>
						<SwiftText>{placeholder ?? tc("pickDate")}</SwiftText>
					</Button>
				)}
			</NativeHost>
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
