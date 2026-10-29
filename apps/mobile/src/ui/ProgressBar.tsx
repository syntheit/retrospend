import { View } from "react-native";
import { useTheme } from "@/theme";

/**
 * How much of a whole is used: a bar on the raised track, accent for the data
 * and attention once it is over. It only draws a length; the share is the
 * server's (never worked out here) and the words next to it carry the status,
 * so the bar hides from screen readers. `thin` (4) sits in a list row under a
 * title; `regular` (8) stands alone in a sheet or header.
 */
export function ProgressBar({
	percent,
	over = false,
	weight = "thin",
}: {
	/** 0 to 100; out of range is clamped. */
	percent: number;
	over?: boolean;
	weight?: "thin" | "regular";
}) {
	const { color, radius, space } = useTheme();
	const height = weight === "thin" ? space[1] : space[2];
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={{
				height,
				borderRadius: radius.chip,
				backgroundColor: color.raised,
				overflow: "hidden",
			}}
		>
			<View
				style={{
					width: `${Math.max(0, Math.min(100, percent))}%`,
					height,
					borderRadius: radius.chip,
					backgroundColor: over ? color.attention : color.accent,
				}}
			/>
		</View>
	);
}
