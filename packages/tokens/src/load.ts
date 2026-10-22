// Reads the DTCG source with Style Dictionary, once per theme. The dark theme
// is tokens.json with tokens.dark.json on top, so a reference such as
// {color.brand} resolves to the dark brand there. Style Dictionary resolves
// references and keeps each token's original value, which the CSS output
// needs to write var(--x) instead of a copy of the value.
import { fileURLToPath } from "node:url";
import StyleDictionary from "style-dictionary";
import type { TransformedToken } from "style-dictionary/types";

export type Theme = "light" | "dark";
export type Tokens = Map<string, TransformedToken>;
/** DTCG dimension and duration values: { value: 8, unit: "px" }. */
export type Dimension = { value: number; unit: string };
export type ShadowLayer = {
	color: string;
	offsetX: Dimension;
	offsetY: Dimension;
	blur: Dimension;
	spread: Dimension;
};

const BASE = fileURLToPath(new URL("./tokens.json", import.meta.url));
const DARK = fileURLToPath(new URL("./tokens.dark.json", import.meta.url));

async function loadTheme(theme: Theme): Promise<Tokens> {
	const sd = new StyleDictionary({
		include: theme === "dark" ? [BASE] : [],
		source: theme === "dark" ? [DARK] : [BASE],
		platforms: { all: {} },
		log: { verbosity: "silent", warnings: "error" },
	});
	const { allTokens } = await sd.getPlatformTokens("all");
	return new Map(allTokens.map((t) => [t.path.join("."), t]));
}

/** Every token of both themes, keyed by dotted path ("color.bg"), in source order. */
export async function loadTokens(): Promise<Record<Theme, Tokens>> {
	const [light, dark] = await Promise.all([
		loadTheme("light"),
		loadTheme("dark"),
	]);
	return { light, dark };
}

/** The tokens tokens.dark.json changes. */
export function darkOverrides(dark: Tokens): TransformedToken[] {
	return [...dark.values()].filter((t) => t.isSource);
}
