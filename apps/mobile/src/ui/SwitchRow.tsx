import { Switch } from "@expo/ui";
import { View } from "react-native";
import { useTheme } from "@/theme";
import { NativeHost } from "./NativeHost";
import { Text } from "./Text";

/**
 * The system switch's own size (SwiftUI 51 by 31, Material 3 52 by 32), not a
 * design value: the control draws at this size whatever the row does.
 */
const SWITCH_WIDTH = 52;
const SWITCH_HEIGHT = 32;

/**
 * The switch's host in its row: a fixed box the size of the switch that does
 * not shrink. A host that matches its contents has no width until the native
 * control reports one after its first layout, and that report is written into
 * the layout node only once; next to a long detail sentence (Send feedback)
 * the label's flex took the whole row and the switch was never drawn. A fixed
 * box is there from the first frame.
 */
export function switchHostStyle() {
	return {
		flexShrink: 0,
		width: SWITCH_WIDTH,
		height: SWITCH_HEIGHT,
	} as const;
}

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
			<NativeHost matchContents={false} style={switchHostStyle()}>
				<Switch disabled={disabled} onValueChange={onChange} value={value} />
			</NativeHost>
		</View>
	);
}
