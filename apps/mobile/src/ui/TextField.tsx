import { Text, TextInput, View } from "react-native";
import { useTheme } from "@/theme";

/** A labeled text field at the 44pt minimum: the one plain input of sheets. */
export function TextField({
	label,
	value,
	onChangeText,
	prefix,
	invalid,
	keyboardType,
	placeholder,
	autoCapitalize = "none",
}: {
	label: string;
	value: string;
	onChangeText: (text: string) => void;
	prefix?: string;
	invalid?: boolean;
	keyboardType?: "default" | "decimal-pad" | "number-pad" | "url";
	placeholder?: string;
	autoCapitalize?: "none" | "sentences" | "words";
}) {
	const { color, radius, size, space, type } = useTheme();
	return (
		<View style={{ gap: space[2] }}>
			<Text style={{ color: color.fg2, fontSize: type.small.size }}>
				{label}
			</Text>
			<View
				style={{
					minHeight: size.moneyInput.phone,
					flexDirection: "row",
					alignItems: "center",
					paddingHorizontal: space[3],
					borderRadius: radius.ctl,
					borderWidth: 1,
					borderColor: invalid ? color.danger : color.lineStrong,
					backgroundColor: color.surface,
				}}
			>
				{prefix ? (
					<Text style={{ color: color.fg2, fontSize: type.body.size }}>
						{prefix}
					</Text>
				) : null}
				<TextInput
					accessibilityLabel={label}
					autoCapitalize={autoCapitalize}
					autoCorrect={false}
					keyboardType={keyboardType}
					onChangeText={onChangeText}
					placeholder={placeholder}
					placeholderTextColor={color.fg3}
					style={{ flex: 1, color: color.fg, fontSize: type.body.size }}
					value={value}
				/>
			</View>
		</View>
	);
}
