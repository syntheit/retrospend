import type { ReactNode } from "react";
import { View } from "react-native";
import { useTheme } from "@/theme";
import { Text, type TextTone } from "./Text";

type Tone = Extract<TextTone, "fg" | "positive" | "attention" | "danger">;

/**
 * The one hero number of a screen (GUIDELINE §3, §7): a label at 13 fg-2 (or 14 in the figure's tone, `labelTone`),
 * the value at hero size with its line height and tracking, and an optional
 * sub line at 13 fg-2 (or 12 fg-3, `subTone`; the change over 30 days, the scrubbed day, a short
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
	labelTone = "fg2",
	subTone = "fg2",
	align = "start",
}: {
	label: string;
	value: string;
	/** One line under the value: text, or a node that holds a link. */
	sub?: ReactNode;
	tone?: Tone;
	/**
	 * The label's color job: fg2 at 13 (default), or `hero` for a sentence
	 * that carries the figure's tone at 14 ("Lucia owes you").
	 */
	labelTone?: "fg2" | "hero";
	/** The sub line: fg2 at 13 (default), or fg3 at 12 for the quiet parts line. */
	subTone?: "fg2" | "fg3";
	align?: "start" | "center";
}) {
	const { size, space, type } = useTheme();
	// Phones draw the hero at its own size (size.hero.phone); the rest of type.hero holds.
	const heroSize = size.hero.phone;
	const textAlign = align === "center" ? "center" : "left";
	const subText = typeof sub === "string" ? sub : null;
	const labelHero = labelTone === "hero";
	const quiet = subTone === "fg3";

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
				<Text
					style={{ textAlign }}
					tone={labelHero ? tone : "fg2"}
					variant={labelHero ? "body" : "small"}
				>
					{label}
				</Text>
				<Text
					adjustsFontSizeToFit
					numberOfLines={1}
					style={{
						fontSize: heroSize,
						lineHeight: heroSize * type.hero.lineHeight,
						letterSpacing: heroSize * type.hero.tracking,
						textAlign,
					}}
					tone={tone}
					variant="hero"
				>
					{value}
				</Text>
				{subText !== null ? (
					<Text
						numberOfLines={1}
						style={{ textAlign }}
						tone={quiet ? "fg3" : "fg2"}
						variant={quiet ? "meta" : "small"}
					>
						{subText}
					</Text>
				) : null}
			</View>
			{sub != null && subText === null ? (
				<View style={{ minHeight: type.small.size * type.small.lineHeight }}>
					{sub}
				</View>
			) : null}
		</View>
	);
}
