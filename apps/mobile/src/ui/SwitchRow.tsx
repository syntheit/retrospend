import { Switch } from "@expo/ui";
import { View } from "react-native";
import { useTheme } from "@/theme";
import { NativeHost } from "./NativeHost";
import { Text } from "./Text";

/**
 * A label with the system switch at the end, and a quiet sentence under the
 * row when there is one. The sentence sits below the label and switch, across
 * the whole width, so a long one can never take the room the switch needs
 * (beside it, in Send feedback, the label column took the whole row and the
 * switch had no width). The label column may shrink (`minWidth: 0`). The
 * iOS 26 switch draws a little wider than the size it reports, and a sheet's
 * scroll area cuts that off at its edge, so the host keeps a small margin.
 */
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
		<View style={{ gap: space[1] }}>
			<View
				style={{
					minHeight: size.touchMin.phone,
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "space-between",
					gap: space[3],
				}}
			>
				<View style={{ flex: 1, minWidth: 0 }}>
					<Text>{label}</Text>
				</View>
				<NativeHost style={{ flexShrink: 0, marginEnd: space[1] }}>
					<Switch disabled={disabled} onValueChange={onChange} value={value} />
				</NativeHost>
			</View>
			{detail ? (
				<Text tone="fg2" variant="small">
					{detail}
				</Text>
			) : null}
		</View>
	);
}
