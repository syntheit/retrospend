import type { ReactNode } from "react";
import {
	Text as NativeText,
	type TextProps as NativeTextProps,
	type TextStyle,
} from "react-native";
import { type Theme, useTheme } from "@/theme";
// Not from "@/theme": tests that mock the theme hook still get the faces.
import { fontFamilyFor } from "@/theme/fonts";

/** The type roles (GUIDELINE §2.3): one size, line height, weight and tracking each. */
export type TextRole = "hero" | "title" | "section" | "body" | "small" | "meta";

/** Which color job the words do (GUIDELINE §2.1). */
export type TextTone =
	| "fg"
	| "fg2"
	| "fg3"
	| "positive"
	| "attention"
	| "danger";

/** The three weights; a role carries its own, this overrides it (row titles at medium). */
export type TextWeight = keyof Theme["font"]["weight"];

/**
 * The font style of a role, without a color: DM Sans at the role's size,
 * line height and tracking. For text that is not a Text, such as a
 * TextInput's value, so it matches the words around it.
 */
export function typeStyle(
	theme: Theme,
	role: TextRole,
	options: { weight?: TextWeight; tabular?: boolean } = {},
): TextStyle {
	const t = theme.type[role];
	const weight = options.weight ? theme.font.weight[options.weight] : t.weight;
	const tabular = options.tabular ?? role === "hero";
	return {
		fontFamily: fontFamilyFor(weight),
		fontSize: t.size,
		lineHeight: Math.round(t.size * t.lineHeight),
		letterSpacing: "tracking" in t ? t.tracking * t.size : 0,
		...(tabular ? { fontVariant: ["tabular-nums" as const] } : null),
	};
}

export function toneColor(theme: Theme, tone: TextTone): string {
	const { color } = theme;
	switch (tone) {
		case "fg":
			return color.fg;
		case "fg2":
			return color.fg2;
		case "fg3":
			return color.fg3;
		case "positive":
			return color.positive;
		case "attention":
			return color.attentionText;
		case "danger":
			return color.danger;
	}
}

export type TextProps = NativeTextProps & {
	/** The type role; body unless said otherwise. Not `role`, which is the ARIA role. */
	variant?: TextRole;
	/** The color job; fg unless said otherwise. */
	tone?: TextTone;
	/** Overrides the role's weight. */
	weight?: TextWeight;
	/** Tabular, lining figures for numbers that line up; the hero has them already. */
	tabular?: boolean;
	children?: ReactNode;
};

/**
 * All words in the app go through here: a variant (the type role) sets the size, line height,
 * weight and tracking from the type tokens, a tone sets the color. iOS
 * chrome (navigation bars, tab bar, menus) keeps the system font.
 */
export function Text({
	variant = "body",
	tone = "fg",
	weight,
	tabular,
	style,
	...rest
}: TextProps) {
	const theme = useTheme();
	return (
		<NativeText
			{...rest}
			style={[
				typeStyle(theme, variant, { weight, tabular }),
				{ color: toneColor(theme, tone) },
				style,
			]}
		/>
	);
}
