import { Switch } from "@expo/ui";
import { View } from "react-native";
import { useTheme } from "@/theme";
import { NativeHost } from "./NativeHost";
import { Text } from "./Text";

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
	const { size, space } = useTheme();
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
				<Text>{label}</Text>
				{detail ? (
					<Text tone="fg2" variant="small">
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
