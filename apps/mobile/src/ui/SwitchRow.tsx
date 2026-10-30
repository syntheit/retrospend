import { Switch } from "@expo/ui";
import { View } from "react-native";
import { useTheme } from "@/theme";
import { NativeHost } from "./NativeHost";
import { Text } from "./Text";

/**
 * The switch's host in its row. A host that matches its contents has no width
 * until the native control reports one; next to a long detail sentence the
 * label took the whole row and the switch was never drawn (Send feedback). The
 * host does not shrink and starts at the touch target, so it keeps its room.
 */
export function switchHostStyle(touch: number) {
	return { flexShrink: 0, minWidth: touch, minHeight: touch } as const;
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
			<NativeHost style={switchHostStyle(size.touchMin.phone)}>
				<Switch disabled={disabled} onValueChange={onChange} value={value} />
			</NativeHost>
		</View>
	);
}
