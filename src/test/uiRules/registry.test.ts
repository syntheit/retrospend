// UI-040: every primitive in src/components/ui is registered with its job.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REGISTRY } from "../../components/ui/registry";
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
});
