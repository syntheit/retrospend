import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLANNED } from "~/components/ui/registry";

const ROOT = join(import.meta.dirname, "../../../..");

describe("registry: built components", () => {
	it("every built entry exists at its target", () => {
		const built = PLANNED.filter((p) => p.status === "built");
		expect(built.length).toBeGreaterThan(0);
		for (const p of built) {
			// A target may add a note after the path: "src/x.tsx (with y)".
			const path = p.target.split(" ")[0] ?? "";
			expect(path, p.name).toMatch(/^src\/.+\.tsx?$/);
			expect(existsSync(join(ROOT, path)), `${p.name}: ${path}`).toBe(true);
		}
	});

	it("a planned entry does not exist yet (mark it built when it lands)", () => {
		for (const p of PLANNED.filter((x) => x.status === "planned")) {
			const path = p.target.split(" ")[0] ?? "";
			if (/\.tsx?$/.test(path))
				expect(existsSync(join(ROOT, path)), `${p.name}: ${path}`).toBe(false);
		}
	});
});

describe("reduced motion in globals.css (UI-102)", () => {
	const css = readFileSync(join(ROOT, "src/styles/globals.css"), "utf8");
	const block = css.slice(
		css.indexOf("@media (prefers-reduced-motion: reduce)"),
	);

	it("no longer zeroes every duration, so fades survive", () => {
		expect(css).not.toMatch(/(?:animation|transition)-duration:\s*0\.01ms/);
	});

	it("stops transitions of transform, size and position", () => {
		const props =
			/transition-property:([^!]+)!important/.exec(block)?.[1] ?? "";
		expect(props).toContain("opacity");
		for (const moving of [
			"transform",
			"width",
			"height",
			"margin",
			"left",
			"all",
		])
			expect(props).not.toMatch(new RegExp(`\\b${moving}\\b`));
	});

	it("flattens tw-animate enter and exit to a fade", () => {
		for (const v of ["translate-x", "translate-y", "scale", "rotate", "blur"]) {
			expect(block).toContain(`--tw-enter-${v}:`);
			expect(block).toContain(`--tw-exit-${v}:`);
		}
	});

	it("turns moving keyframes into fades and spinners into a pulse", () => {
		for (const sel of [
			"animate-accordion-down",
			"animate-collapsible-up",
			".settle-success-icon",
			"page-enter",
			"[data-vaul-drawer]",
			".animate-spin",
			".animate-bounce",
			"cb-float",
		])
			expect(block).toContain(sel);
	});
});
