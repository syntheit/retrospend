import { View } from "react-native";
import { useTheme } from "@/theme";

/**
 * How much of what an envelope holds is spent: a thin bar on the raised
 * track, accent for the data and attention once it is over. The share is the
 * server's `spentBasis` (hundredths of a percent, 0 to 10000), never worked
 * out here; a savings goal has none and draws no bar. The facts under it say
 * the same in words, so the bar hides from screen readers.
 */
export function EnvelopeBar({
	basis,
	over,
}: {
	basis: number | null;
	over: boolean;
}) {
	const { color, radius, space } = useTheme();
	if (basis === null) return null;
	const share = Math.min(Math.max(basis, 0), 10_000) / 100;
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={{
				height: space[2],
				borderRadius: radius.chip,
				backgroundColor: color.raised,
				overflow: "hidden",
			}}
		>
			<View
				style={{
					width: `${share}%`,
					height: space[2],
					borderRadius: radius.chip,
					backgroundColor: over ? color.attention : color.accent,
				}}
			/>
		</View>
	);
}
