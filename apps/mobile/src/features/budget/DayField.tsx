import { Text, TextInput, View } from "react-native";
import { useTheme } from "@/theme";

/** A date as YYYY-MM-DD text: the server's own date format, checked for a real day. */
export function isIsoDay(text: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
	const d = new Date(`${text}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

/** A day typed as 2026-11-05. The phone has no date control yet, so the format is the hint. */
export function DayField({
	label,
	value,
	onChangeText,
	hint,
}: {
	label: string;
	value: string;
	onChangeText: (text: string) => void;
	hint: string;
}) {
	const { color, radius, size, space, type } = useTheme();
	const bad = value !== "" && !isIsoDay(value);
	return (
		<View style={{ gap: space[2] }}>
			<Text style={{ color: color.fg2, fontSize: type.small.size }}>
				{label}
			</Text>
			<TextInput
				accessibilityLabel={label}
				autoCapitalize="none"
				autoCorrect={false}
				keyboardType="numbers-and-punctuation"
				maxLength={10}
				onChangeText={onChangeText}
				placeholder={hint}
				placeholderTextColor={color.fg3}
				style={{
					minHeight: size.touchMin.phone,
					paddingHorizontal: space[3],
					borderRadius: radius.ctl,
					borderWidth: 1,
					borderColor: bad ? color.danger : color.lineStrong,
					backgroundColor: color.surface,
					color: color.fg,
					fontSize: type.body.size,
					fontVariant: ["tabular-nums"],
				}}
				value={value}
			/>
		</View>
	);
}
