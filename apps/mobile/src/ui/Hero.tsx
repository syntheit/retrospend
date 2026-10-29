import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { useTheme } from "@/theme";

type Tone = "fg" | "positive" | "attention" | "danger";

/** A token weight (400, 500, 600) as the string React Native takes. */
const weight = (value: number) => String(value) as "400" | "500" | "600";

/**
 * The one hero number of a screen (GUIDELINE §3, §7): a label at 13 fg-2,
 * the value at hero size with its line height and tracking, and an optional
 * sub line at 13 fg-2 (the change over 30 days, the scrubbed day, a short
 * sentence). The value arrives formatted by the money formatter, or as words
 * when it is missing ("No rate yet"); the hero never computes or rounds it.
 * The label, value and a text sub line read as one element and announce a
 * change (a scrub). A sub line that holds a control (a link to a sheet) is
 * left out of that element so it stays reachable on its own.
 */
export function Hero({
	label,
	value,
	sub,
	tone = "fg",
	align = "start",
}: {
	label: string;
	value: string;
	/** One line under the value: text, or a node that holds a link. */
	sub?: ReactNode;
	tone?: Tone;
	align?: "start" | "center";
}) {
	const { color, size, space, type } = useTheme();
	// Phones draw the hero at its own size (size.hero.phone); the rest of type.hero holds.
	const hero = { ...type.hero, size: size.hero.phone };
	const small = type.small;
	const valueColor = {
		fg: color.fg,
		positive: color.positive,
		attention: color.attentionText,
		danger: color.danger,
	}[tone];
	const textAlign = align === "center" ? "center" : "left";
	const subText = typeof sub === "string" ? sub : null;
	const smallText = {
		color: color.fg2,
		fontSize: small.size,
		lineHeight: small.size * small.lineHeight,
		fontWeight: weight(small.weight),
		textAlign,
	} as const;

	return (
		<View
			style={{
				gap: space[1],
				alignItems: align === "center" ? "center" : "stretch",
			}}
		>
			<View
				accessibilityLabel={[label, value, subText].filter(Boolean).join(", ")}
				accessibilityLiveRegion="polite"
				accessible
				style={{
					gap: space[1],
					alignItems: align === "center" ? "center" : "stretch",
				}}
			>
				<Text style={smallText}>{label}</Text>
				<Text
					adjustsFontSizeToFit
					numberOfLines={1}
					style={{
						color: valueColor,
						fontSize: hero.size,
						lineHeight: hero.size * hero.lineHeight,
						letterSpacing: hero.size * hero.tracking,
						fontWeight: weight(hero.weight),
						fontVariant: ["tabular-nums", "lining-nums"],
						textAlign,
					}}
				>
					{value}
				</Text>
				{subText !== null ? (
					<Text numberOfLines={1} style={smallText}>
						{subText}
					</Text>
				) : null}
			</View>
			{sub != null && subText === null ? (
				<View style={{ minHeight: small.size * small.lineHeight }}>{sub}</View>
			) : null}
		</View>
	);
}
