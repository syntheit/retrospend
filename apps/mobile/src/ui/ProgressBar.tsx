import { View } from "react-native";
import { useTheme } from "@/theme";

/**
 * How much of a whole is used: a bar on the raised track, accent for the data
 * and attention once it is over. It only draws a length; the share is the
 * server's (never worked out here) and the words next to it carry the status,
 * so the bar hides from screen readers. `thin` (4) sits in a list row under a
 * title; `regular` (8) stands alone in a sheet or header. `mark` draws a
 * line over the bar at a share of it (today in a month), so the bar reads
 * against the pace; it is a position, not a figure.
 */
export function ProgressBar({
	percent,
	over = false,
	weight = "thin",
	mark,
}: {
	/** 0 to 100; out of range is clamped. */
	percent: number;
	over?: boolean;
	weight?: "thin" | "regular";
	/** 0 to 100: where the line stands; none by default. */
	mark?: number;
}) {
	const { chart, color, radius, space } = useTheme();
	const height = weight === "thin" ? space[1] : space[2];
	return (
		<View
			accessibilityElementsHidden
			importantForAccessibility="no-hide-descendants"
			style={{ height }}
		>
			<View
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
			{mark === undefined ? null : (
				<View
					style={{
						position: "absolute",
						left: `${Math.max(0, Math.min(100, mark))}%`,
						top: -chart.line,
						bottom: -chart.line,
						width: chart.line,
						marginLeft: -chart.line / 2,
						borderRadius: chart.line / 2,
						backgroundColor: color.fg,
					}}
				/>
			)}
		</View>
	);
}
