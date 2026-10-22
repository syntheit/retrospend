// UI-040: every primitive in src/components/ui is registered with its job, and
// every PLAN §6 component is either a core file or a planned entry.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	PLAN_COMPONENTS,
	PLANNED,
	REGISTRY,
} from "../../components/ui/registry";
import { REPO_ROOT } from "./paths";

const UI = join(REPO_ROOT, "src/components/ui");
const files = readdirSync(UI)
	.filter((f) => /\.tsx?$/.test(f) && f !== "registry.ts")
	.map((f) => f.replace(/\.tsx?$/, ""));

describe("primitive registry", () => {
	it("UI-040: every file in src/components/ui has a registry entry (a new primitive needs the owner's sign-off)", () => {
		const known = new Set(REGISTRY.map((p) => p.file));
		const missing = files.filter((f) => !known.has(f));
		expect(
			missing,
			"add these to src/components/ui/registry.ts, with the owner's sign-off",
		).toEqual([]);
	});

	it("registry entries are unique, point at real files and say what to use instead", () => {
		expect(new Set(REGISTRY.map((p) => p.file)).size).toBe(REGISTRY.length);
		for (const p of REGISTRY) {
			const real =
				existsSync(join(UI, `${p.file}.tsx`)) ||
				existsSync(join(UI, `${p.file}.ts`));
			expect(real, `${p.file} does not exist`).toBe(true);
			expect(p.job.length, `${p.file} needs a job`).toBeGreaterThan(10);
			if (p.status !== "core")
				expect(
					p.use,
					`${p.file} (${p.status}) must name a replacement`,
				).toBeTruthy();
		}
	});

	it("UI-040: every PLAN §6 component maps to a core file or a planned entry", () => {
		const core = new Map<string, string>();
		for (const p of REGISTRY)
			for (const name of p.plan ?? []) {
				expect(p.status, `${name} maps to ${p.file}, which is not core`).toBe(
					"core",
				);
				expect(core.has(name), `${name} maps to two core files`).toBe(false);
				core.set(name, p.file);
			}
		const planned = new Set(PLANNED.map((p) => p.name));
		expect(planned.size, "planned names are unique").toBe(PLANNED.length);
		const unmapped = PLAN_COMPONENTS.filter(
			(n) => !core.has(n) && !planned.has(n),
		);
		expect(
			unmapped,
			"PLAN §6 components with neither a core file nor a planned entry",
		).toEqual([]);
		const both = PLAN_COMPONENTS.filter((n) => core.has(n) && planned.has(n));
		expect(both, "a component is either core or planned").toEqual([]);
		const known = new Set(PLAN_COMPONENTS);
		const stray = [...core.keys(), ...planned].filter((n) => !known.has(n));
		expect(stray, "names that are not in PLAN §6").toEqual([]);
	});

	it("planned entries say their job, what they replace, their PLAN row and target", () => {
		for (const p of PLANNED) {
			expect(p.job.length, `${p.name} needs a job`).toBeGreaterThan(10);
			expect(p.replaces, `${p.name} must say what it replaces`).toBeTruthy();
			expect(
				p.planRow.includes(p.name),
				`${p.name}: planRow must be its PLAN §6 row`,
			).toBe(true);
			expect(p.target, `${p.name} needs a target path`).toMatch(/^src\//);
			expect(
				p.use,
				`${p.name} must say what to use until it exists`,
			).toBeTruthy();
		}
	});
});
