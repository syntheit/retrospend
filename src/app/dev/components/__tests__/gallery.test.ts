// The gallery covers the registry: every PLAN §6 component has a section,
// every section is rendered, and each built component is defined once (no
// lookalike under another folder, R18).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { PLAN_COMPONENTS, PLANNED, REGISTRY } from "~/components/ui/registry";
import { REPO_ROOT } from "~/test/uiRules/paths";
import { canSeeGallery } from "../access";
import { SECTIONS } from "../sections";

const HERE = join(REPO_ROOT, "src/app/dev/components");

function files(dir: string): string[] {
	return readdirSync(dir).flatMap((f) => {
		const p = join(dir, f);
		if (statSync(p).isDirectory())
			return f === "__tests__" || f === "node_modules" ? [] : files(p);
		return /\.tsx?$/.test(f) ? [p] : [];
	});
}

/**
 * Today's pages still use these older components of the same name; the
 * overhaul replaces them page by page (registry: date-picker; the old
 * category picker is one of the "4 category pickers"). Nothing else may
 * share a built component's name.
 */
const BEING_REPLACED: Record<string, string> = {
	CategoryPicker: "src/components/category-picker.tsx",
	DatePicker: "src/components/ui/date-picker.tsx",
};

const gallerySource = files(HERE)
	.map((f) => readFileSync(f, "utf8"))
	.join("\n");

describe("component gallery", () => {
	it("has a section for every PLAN §6 component", () => {
		const shown = new Set(SECTIONS.flatMap((s) => s.components));
		expect(PLAN_COMPONENTS.filter((n) => !shown.has(n))).toEqual([]);
	});

	it("names only PLAN §6 components, each in one section", () => {
		const all = SECTIONS.flatMap((s) => s.components);
		expect(all.filter((n) => !PLAN_COMPONENTS.includes(n))).toEqual([]);
		expect(new Set(all).size).toBe(all.length);
	});

	it("renders every section, in components.html order, ids unique", () => {
		const ids = SECTIONS.map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids)
			expect(gallerySource, `section ${id} is never rendered`).toMatch(
				new RegExp(`<Spec[^>]*id="${id}"`),
			);
	});

	it("marks a section pending only while one of its components is still planned", () => {
		const planned = new Set(
			PLANNED.filter((p) => p.status === "planned").map((p) => p.name),
		);
		for (const s of SECTIONS)
			if (s.pending)
				expect(
					s.components.some((n) => planned.has(n)),
					`${s.id} says pending but everything in it is built`,
				).toBe(true);
	});

	it("defines each built component once in src (no lookalikes, R18)", () => {
		const src = files(join(REPO_ROOT, "src")).filter(
			(f) => !f.includes("/__tests__/") && !f.endsWith(".test.ts"),
		);
		const text = src.map((f) => [
			relative(REPO_ROOT, f),
			readFileSync(f, "utf8"),
		]);
		const built = PLANNED.filter((p) => p.status === "built").map(
			(p) => p.name,
		);
		const twice: string[] = [];
		for (const name of built) {
			const re = new RegExp(`export (?:function|const) ${name}\\b`);
			const where = text
				.filter(([, t]) => re.test(t ?? ""))
				.map(([f]) => f)
				.filter((f) => f !== BEING_REPLACED[name]);
			if (where.length > 1) twice.push(`${name}: ${where.join(", ")}`);
		}
		expect(twice).toEqual([]);
	});

	it("uses no legacy or internal primitive", () => {
		const banned = REGISTRY.filter((p) => p.status !== "core").map(
			(p) => p.file,
		);
		const hits = banned.filter((f) =>
			new RegExp(`from "~/components/ui/${f}"`).test(gallerySource),
		);
		expect(hits).toEqual([]);
	});
});

describe("gallery access", () => {
	it("is open in development and to admins in production", () => {
		expect(canSeeGallery("development", undefined)).toBe(true);
		expect(canSeeGallery("test", "USER")).toBe(true);
		expect(canSeeGallery("production", "ADMIN")).toBe(true);
	});

	it("is a 404 for everyone else in production", () => {
		expect(canSeeGallery("production", "USER")).toBe(false);
		expect(canSeeGallery("production", undefined)).toBe(false);
		expect(canSeeGallery("production", null)).toBe(false);
	});
});
