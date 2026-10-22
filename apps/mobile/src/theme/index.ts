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
export function themeFor(scheme: ColorSchemeName): Theme {
	return scheme === "dark" ? dark : light;
}

export function useTheme(): Theme {
	return themeFor(useColorScheme());
}

/** Navigation chrome colors (headers, tab bar, screen background) from the same tokens. */
export function navigationTheme(scheme: ColorSchemeName): NavigationTheme {
	const base = scheme === "dark" ? DarkTheme : DefaultTheme;
	const { color } = themeFor(scheme);
	return {
		...base,
		colors: {
			primary: color.accent,
			background: color.bg,
			card: color.bg,
			text: color.fg,
			border: color.line,
			notification: color.danger,
		},
	};
}
