import { Switch } from "@expo/ui";
import { Text, View } from "react-native";
import { useTheme } from "@/theme";
import { NativeHost } from "./NativeHost";

/** A label (and a quiet sentence under it) with the system switch at the end. */
export function SwitchRow({
	label,
	detail,
	value,
	onChange,
	disabled,
}: {
	label: string;
	detail?: string;
	value: boolean;
	onChange: (value: boolean) => void;
	disabled?: boolean;
}) {
	const { color, size, space, type } = useTheme();
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
			<View style={{ flex: 1, gap: space[1] }}>
				<Text style={{ color: color.fg, fontSize: type.body.size }}>
					{label}
				</Text>
				{detail ? (
					<Text style={{ color: color.fg2, fontSize: type.small.size }}>
						{detail}
					</Text>
				) : null}
			</View>
			<NativeHost>
				<Switch disabled={disabled} onValueChange={onChange} value={value} />
			</NativeHost>
		</View>
	);
}
