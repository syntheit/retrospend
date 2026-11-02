import type { ReactNode } from "react";
import {
	Text as NativeText,
	type TextProps as NativeTextProps,
	Platform,
	type TextStyle,
} from "react-native";
import { type Theme, useTheme } from "@/theme";
// Not from "@/theme": tests that mock the theme hook still get the faces.
import { fontFamilyFor } from "@/theme/fonts";
import { useFontScale } from "./fontScale";

/** The type roles (GUIDELINE §2.3): one size, line height, weight and tracking each. */
export type TextRole = "hero" | "title" | "section" | "body" | "small" | "meta";

/**
 * How far the user's text size may grow a Text (GUIDELINE §14). Body text
 * keeps growing to 1.5 so it stays readable; chrome (chips, tabs, operator
 * keys, button labels) stops at 1.3 because its boxes are a fixed control
 * height and clip past that. The same two numbers cap the native buttons
 * and menu chips (useChromeTextSize), so every control on a screen scales
 * together.
 */
export const TEXT_SCALE_CAP = { body: 1.5, chrome: 1.3 } as const;

/** Which of the two caps a Text takes. */
export type TextScale = keyof typeof TEXT_SCALE_CAP;

/**
 * A point size for text a native host draws (SwiftUI, Compose), grown by the
 * user's text size up to the chrome cap, the way a chrome Text grows. SwiftUI
 * text at a fixed size never scales, so it is multiplied here; Compose reads
 * the size in sp and scales it itself, so the growth the cap removes is taken
 * back out.
 */
export function nativeTextSize(
	base: number,
	fontScale: number,
	cap: number = TEXT_SCALE_CAP.chrome,
	os: string = Platform.OS,
): number {
	const scale = Math.max(fontScale, 1);
	const capped = Math.min(scale, cap);
	return os === "android" ? (base * capped) / scale : base * capped;
}

/** `nativeTextSize` for the current text size setting; it updates when the setting does. */
export function useChromeTextSize(base: number): number {
	return nativeTextSize(base, useFontScale());
}

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

/** Words yield to their row instead of pushing the row's other views away. */
const YIELDS = { flexShrink: 1 } as const;

export type TextProps = NativeTextProps & {
	/** The type role; body unless said otherwise. Not `role`, which is the ARIA role. */
	variant?: TextRole;
	/** The color job; fg unless said otherwise. */
	tone?: TextTone;
	/** Overrides the role's weight. */
	weight?: TextWeight;
	/** `chrome` stops the user's text size at 1.3 for a control with a fixed height; body (1.5) otherwise. */
	scale?: TextScale;
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
	scale = "body",
	style,
	...rest
}: TextProps) {
	const theme = useTheme();
	return (
		<NativeText
			maxFontSizeMultiplier={TEXT_SCALE_CAP[scale]}
			{...rest}
			style={[
				typeStyle(theme, variant, { weight, tabular }),
				{ color: toneColor(theme, tone) },
				// React Native never shrinks a view by default (flexShrink 0), so a
				// line beside another view pushed it off the row. Words yield to
				// their row (wrapping, or ending in an ellipsis when clamped); a
				// figure that fits itself (adjustsFontSizeToFit) keeps its width.
				rest.adjustsFontSizeToFit ? null : YIELDS,
				style,
			]}
		/>
	);
}
