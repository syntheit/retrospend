import { Button, DatePicker, Text as SwiftText } from "@expo/ui/swift-ui";
import {
	accessibilityLabel as a11yLabel,
	datePickerStyle,
	tint,
} from "@expo/ui/swift-ui/modifiers";
import { dayKey } from "@retrospend/domain/time-zone";
import { Text, View } from "react-native";
import { useTranslations } from "use-intl";
import { dayOfPicker, pickerDate } from "@/features/entry/dates";
import { useTheme } from "@/theme";
import { NativeHost } from "./NativeHost";
import type { DateFieldProps } from "./types";

/**
 * The system date control (SwiftUI compact DatePicker) at the end of a
 * labeled row. With no day picked it shows a text button that picks today,
 * after which the compact picker takes over.
 */
export function DateField({
	label,
	value,
	onChange,
	placeholder,
}: DateFieldProps) {
	const { color, size, space, type } = useTheme();
	const t = useTranslations("mobile.pickers");
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
			<Text style={{ color: color.fg, fontSize: type.body.size }}>{label}</Text>
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
						selection={pickerDate(value, "local")}
					/>
				) : (
					<Button
						modifiers={[tint(color.brand), a11yLabel(label)]}
						onPress={() => onChange(dayKey(new Date()))}
					>
						<SwiftText>{placeholder ?? t("pickDate")}</SwiftText>
					</Button>
				)}
			</NativeHost>
		</View>
	);
}
