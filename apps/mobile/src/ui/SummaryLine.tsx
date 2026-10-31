import { Fragment } from "react";
import { useTheme } from "@/theme";
import { Text } from "./Text";

/** One answer in the line: its words and the panel it opens. */
export interface SummaryPart {
	key: string;
	text: string;
	onPress: () => void;
	/** An answer still missing reads in the attention color ("Pick a category"). */
	tone?: "attention";
	/** The part whose panel is showing: underlined, so it is never color alone. */
	active?: boolean;
	accessibilityLabel?: string;
}

/** The text between parts. */
export const SUMMARY_SEPARATOR = " · ";

/**
 * The answers so far as one plain sentence, "Cafe · Today · Split 4 ways,
 * Martín paid · Bariloche trip", centered, wrapping to at most two lines. Each
 * part is a button that opens its panel. The parts are inline words, so they
 * wrap with the text; the tabs under the line are the 44 point targets for the
 * same panels.
 */
export function SummaryLine({
	parts,
	accessibilityLabel,
}: {
	parts: SummaryPart[];
	accessibilityLabel?: string;
}) {
	const { color } = useTheme();
	return (
		<Text
			accessibilityLabel={accessibilityLabel}
			numberOfLines={2}
			style={{ textAlign: "center" }}
		>
			{parts.map((part, index) => (
				<Fragment key={part.key}>
					{index > 0 ? (
						<Text style={{ color: color.lineStrong }}>{SUMMARY_SEPARATOR}</Text>
					) : null}
					<Text
						accessibilityLabel={part.accessibilityLabel ?? part.text}
						accessibilityRole="button"
						accessibilityState={{ selected: part.active === true }}
						onPress={part.onPress}
						style={
							part.active
								? { textDecorationLine: "underline" as const }
								: undefined
						}
						tone={part.tone ?? "fg"}
					>
						{part.text}
					</Text>
				</Fragment>
			))}
		</Text>
	);
}
