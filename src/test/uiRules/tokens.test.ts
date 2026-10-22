// UI-003 (tokens in sync), UI-004 (contrast floor) and UI-102 (reduced motion).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./paths";
import {
	buildTokensCss,
	formatDesign,
	loadDesign,
	type Theme,
	TOKENS_CSS_PATH,
	tokenContrast,
	withHex,
} from "./tokens";

const design = loadDesign();
const THEMES: Theme[] = ["light", "dark"];
const WHITE = { r: 1, g: 1, b: 1, a: 1 };

describe("design tokens", () => {
	it("UI-003: design.json hex values and src/styles/tokens.css are generated from design.json", () => {
		const fresh = withHex(design);
		const hint =
			"stale: run `pnpm ui:tokens` and commit docs/ui/design.json and src/styles/tokens.css";
		expect(
			readFileSync(join(REPO_ROOT, "docs/ui/design.json"), "utf8"),
			hint,
		).toBe(formatDesign(fresh));
		expect(readFileSync(TOKENS_CSS_PATH, "utf8"), hint).toBe(
			buildTokensCss(fresh),
		);
	});

	it("UI-003: globals.css imports the token file", () => {
		const globals = readFileSync(
			join(REPO_ROOT, "src/styles/globals.css"),
			"utf8",
		);
		expect(globals).toMatch(/@import\s+"\.\/tokens\.css";/);
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
					const ratio = tokenContrast(design, fg, bg, theme);
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
				const ratio = tokenContrast(design, fg as string, bg as string, theme);
				expect(
					ratio,
					`${fg} on ${bg} (${theme}) is ${ratio.toFixed(2)}:1`,
				).toBeGreaterThanOrEqual(4.5);
			}
			for (let i = 1; i <= 8; i++) {
				const ratio = tokenContrast(design, WHITE, `avatar-${i}`, theme);
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
				const ratio = tokenContrast(design, t, "bg", theme);
				expect(
					ratio,
					`${t} on bg (${theme}) is ${ratio.toFixed(2)}:1`,
				).toBeGreaterThanOrEqual(3);
			}
		}
	});

	it("UI-102: reduced motion is honored in the token file and globals.css", () => {
		const tokens = readFileSync(TOKENS_CSS_PATH, "utf8");
		const globals = readFileSync(
			join(REPO_ROOT, "src/styles/globals.css"),
			"utf8",
		);
		expect(tokens).toContain("prefers-reduced-motion: reduce");
		expect(globals).toContain("prefers-reduced-motion: reduce");
	});

	it("the motion tokens match the durations UI-100 accepts", async () => {
		const { MOTION_MS } = await import("./rules");
		for (const d of Object.values(design.motion.duration))
			expect(MOTION_MS.has(d.ms), `${d.ms}ms`).toBe(true);
	});
});
