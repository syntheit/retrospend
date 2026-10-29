import { dark, light, type Theme } from "@retrospend/tokens/theme";
import {
	DarkTheme,
	DefaultTheme,
	type Theme as NavigationTheme,
} from "expo-router";
import { type ColorSchemeName, useColorScheme } from "react-native";

export type { Theme };

/**
 * The brand theme for a color scheme. Colors always come from the tokens:
 * Material You dynamic color is off in v1 so the identity and the money
 * colors never change with the wallpaper.
 */
export function themeFor(scheme: ColorSchemeName | null): Theme {
	return scheme === "dark" ? dark : light;
}

export function useTheme(): Theme {
	return themeFor(useColorScheme());
}

/**
 * DM Sans, one loaded face per weight token (app/_layout.tsx loads them).
 * A custom face is picked by family, not by fontWeight: Android would
 * synthesize a bold from the regular face otherwise.
 */
const REGULAR = "DMSans_400Regular";
export const FONT_FAMILY = {
	[light.font.weight.normal]: REGULAR,
	[light.font.weight.medium]: "DMSans_500Medium",
	[light.font.weight.semibold]: "DMSans_600SemiBold",
} as const satisfies Record<number, string>;

/** The DM Sans face for a weight token value (400, 500 or 600). */
export function fontFamilyFor(weight: number): string {
	return FONT_FAMILY[weight] ?? REGULAR;
}

/** Navigation chrome colors (headers, tab bar, screen background) from the same tokens. */
export function navigationTheme(
	scheme: ColorSchemeName | null,
): NavigationTheme {
	const base = scheme === "dark" ? DarkTheme : DefaultTheme;
	const { color } = themeFor(scheme);
	return {
		...base,
		colors: {
			primary: color.brand,
			background: color.bg,
			card: color.bg,
			text: color.fg,
			border: color.line,
			notification: color.danger,
		},
	};
}
