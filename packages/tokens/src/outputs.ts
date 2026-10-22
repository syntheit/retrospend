// Every generated token file, as path (relative to the repo root) and content.
// build.ts writes them; src/test/uiRules/tokens.test.ts checks that the
// committed copies are current.
import { tokensCss } from "./css";
import { loadTokens } from "./load";
import { themeTs, tokensJson } from "./native";

export async function buildOutputs(): Promise<
	{ path: string; content: string }[]
> {
	const themes = await loadTokens();
	return [
		{ path: "src/styles/tokens.css", content: tokensCss(themes) },
		{ path: "packages/tokens/dist/theme.ts", content: themeTs(themes) },
		{ path: "packages/tokens/dist/tokens.json", content: tokensJson(themes) },
	];
}
