// UI-003 (tokens in sync), UI-004 (contrast floor) and UI-102 (reduced motion).
// The tokens live in packages/tokens/src (DTCG JSON); `pnpm ui:tokens`
// generates the CSS and native files from them.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	contrast,
	over,
	parseColor,
	type Rgba,
} from "@retrospend/tokens/color";
import { loadTokens, type Theme } from "@retrospend/tokens/load";
import { buildOutputs } from "@retrospend/tokens/outputs";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./paths";

const tokens = await loadTokens();
const THEMES: Theme[] = ["light", "dark"];
const WHITE = { r: 1, g: 1, b: 1, a: 1 };
const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");

function color(name: string, theme: Theme): Rgba {
	const t = tokens[theme].get(`color.${name}`);
	if (!t) throw new Error(`unknown color token ${name}`);
	return parseColor(t.$value);
}

/** Contrast of `fg` on `bg` in a theme; a translucent fg is composited first. */
function tokenContrast(fg: string | Rgba, bg: string, theme: Theme): number {
	const under = color(bg, theme);
	const top = typeof fg === "string" ? color(fg, theme) : fg;
	return contrast(over(top, under), under);
}

describe("design tokens", () => {
	it("UI-003: every generated token file matches packages/tokens/src", async () => {
		for (const { path, content } of await buildOutputs()) {
			expect(read(path), `${path} is stale: run \`pnpm ui:tokens\``).toBe(
				content,
			);
		}
	});

	it("UI-003: globals.css imports the token file", () => {
		expect(read("src/styles/globals.css")).toMatch(
			/@import\s+"\.\/tokens\.css";/,
		);
	});

	it("UI-004: text tokens reach 4.5:1 on bg, surface and raised in both themes", () => {
		const text = [
			"fg",
			"fg-2",
			"fg-3",
			"accent-strong",
			"attention-text",
			"positive",
			"danger",
			"info",
			"owe",
		];
		for (const theme of THEMES) {
			for (const fg of text) {
				for (const bg of ["bg", "surface", "raised"]) {
					const ratio = tokenContrast(fg, bg, theme);
					expect(
						ratio,
						`${fg} on ${bg} (${theme}) is ${ratio.toFixed(2)}:1`,
					).toBeGreaterThanOrEqual(4.5);
				}
			}
		}
	});

	it("UI-004: text on a fill reaches 4.5:1", () => {
		const pairs = [
			["brand-fg", "brand"],
			["accent-fg", "accent"],
			["danger-fg", "danger"],
			["attention-text", "attention-bg"],
			["info", "info-bg"],
			["danger", "danger-bg"],
		];
		for (const theme of THEMES) {
			for (const [fg, bg] of pairs) {
				const ratio = tokenContrast(fg as string, bg as string, theme);
				expect(
					ratio,
					`${fg} on ${bg} (${theme}) is ${ratio.toFixed(2)}:1`,
				).toBeGreaterThanOrEqual(4.5);
			}
			for (let i = 1; i <= 8; i++) {
				const ratio = tokenContrast(WHITE, `avatar-${i}`, theme);
				expect(
					ratio,
					`white initials on avatar-${i} (${theme})`,
				).toBeGreaterThanOrEqual(4.5);
			}
		}
	});

	it("UI-004: the accent and every series reach 3:1 on bg (graphics)", () => {
		for (const theme of THEMES) {
			for (const t of [
				"accent",
				...Array.from({ length: 8 }, (_, i) => `series-${i + 1}`),
			]) {
				const ratio = tokenContrast(t, "bg", theme);
				expect(
					ratio,
					`${t} on bg (${theme}) is ${ratio.toFixed(2)}:1`,
				).toBeGreaterThanOrEqual(3);
			}
		}
	});

	it("UI-102: reduced motion is honored in the token file and globals.css", () => {
		expect(read("src/styles/tokens.css")).toContain(
			"prefers-reduced-motion: reduce",
		);
		expect(read("src/styles/globals.css")).toContain(
			"prefers-reduced-motion: reduce",
		);
	});

	it("the motion tokens match the durations UI-100 accepts", async () => {
		const { MOTION_MS } = await import("./rules");
		for (const t of tokens.light.values()) {
			if (t.$type === "duration")
				expect(MOTION_MS.has(t.$value.value), t.path.join(".")).toBe(true);
		}
	});
});
