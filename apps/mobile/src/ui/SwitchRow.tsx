import { View } from "react-native";
import { useTheme } from "@/theme";
import { NativeHost } from "./NativeHost";
import { NativeSwitch } from "./NativeSwitch";
import { Text } from "./Text";

/**
 * A label with the system switch at the end, and a quiet sentence under the
 * row when there is one. The sentence sits below the label and switch, across
 * the whole width, so a long one can never take the room the switch needs
 * (beside it, in Send feedback, the label column took the whole row and the
 * switch had no width). The label column may shrink (`minWidth: 0`). The
 * iOS 26 switch draws a little wider than the size it reports, and a sheet's
 * scroll area cuts that off at its edge, so the host keeps a small margin.
 *
 * The on-state is the brand family (a switch is a selection control). The iOS
 * thumb is fixed white, so in dark the brand track (#ffe0c2) is 1.26:1 against
 * it. No token gives 3:1 against both the thumb and the surface: brand 1.26,
 * brandHover 1.24, brandSoft 1.41 on surface, brandFg 1.06 on surface. The
 * tint stays the brand and the thumb position carries the state; Android
 * draws brand with a brandFg thumb (m3Colors, 4.5:1).
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
					<NativeSwitch disabled={disabled} onChange={onChange} value={value} />
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
