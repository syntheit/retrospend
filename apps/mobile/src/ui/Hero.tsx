import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { useTheme } from "@/theme";
import { fitMoney } from "./fitMoney";
import { Glyph } from "./Glyph";
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
 *
 * `help` puts an icon button after the label (a question mark that explains
 * the figure): its `label` is what a screen reader calls it and `hint` is its
 * tooltip text (read as the hint, since a phone has no hover). It sits beside
 * the label, outside the element above, so it stays reachable on its own.
 */
export function Hero({
	label,
	value,
	sub,
	tone = "fg",
	labelTone = "fg2",
	subTone = "fg2",
	align = "start",
	help,
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
	help?: { label: string; hint: string; onPress: () => void };
}) {
	const { color, size, space, type } = useTheme();
	// Phones draw the hero at its own size (size.hero.phone); the rest of type.hero holds.
	const heroSize = size.hero.phone;
	const textAlign = align === "center" ? "center" : "left";
	const subText = typeof sub === "string" ? sub : null;
	const labelHero = labelTone === "hero";
	const quiet = subTone === "fg3";

	const labelText = (
		<Text
			style={{ textAlign }}
			tone={labelHero ? tone : "fg2"}
			variant={labelHero ? "body" : "small"}
		>
			{label}
		</Text>
	);
	const group = (withLabel: boolean) => (
		<View
			accessibilityLabel={[label, value, subText].filter(Boolean).join(", ")}
			accessibilityLiveRegion="polite"
			accessible
			style={{
				gap: space[1],
				alignItems: align === "center" ? "center" : "stretch",
			}}
		>
			{withLabel ? labelText : null}
			<Text
				{...fitMoney}
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
					// A figure in the sub line wraps at a space, never ends in "...".
					numberOfLines={2}
					style={{ textAlign }}
					tone={quiet ? "fg3" : "fg2"}
					variant={quiet ? "meta" : "small"}
				>
					{subText}
				</Text>
			) : null}
		</View>
	);

	return (
		<View
			style={{
				gap: space[1],
				alignItems: align === "center" ? "center" : "stretch",
			}}
		>
			{help ? (
				<View
					style={{
						flexDirection: "row",
						alignItems: "center",
						justifyContent: align === "center" ? "center" : "flex-start",
						gap: space[1],
					}}
				>
					{/* The element below says the label; this copy is for the eye. */}
					<View
						accessibilityElementsHidden
						importantForAccessibility="no-hide-descendants"
					>
						{labelText}
					</View>
					<Pressable
						accessibilityHint={help.hint}
						accessibilityLabel={help.label}
						accessibilityRole="button"
						hitSlop={space[3]}
						onPress={help.onPress}
					>
						<Glyph color={color.fg3} name="CircleHelp" size={size.icon.phone} />
					</Pressable>
				</View>
			) : null}
			{group(!help)}
			{sub != null && subText === null ? (
				<View style={{ minHeight: type.small.size * type.small.lineHeight }}>
					{sub}
				</View>
			) : null}
		</View>
	);
}
