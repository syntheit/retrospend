/**
 * Global setup of `pnpm test:pg` for the money write guard (write-guard.ts):
 * the workers note each number-writes.json entry a write was let through by
 * (pg-env.ts), and after a full, passing normal run every entry must have
 * been used. One that was not is stale: its writer moved to Decimal (or
 * went), so the run fails and names it for removal. A partial, failing or
 * sealed run checks nothing, since it may not reach every writer.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { TestProject } from "vitest/node";
import { scanSources } from "../source-scan";
import { REPO_ROOT } from "../uiRules/paths";
import allowed from "./number-writes.json";

declare module "vitest" {
	export interface ProvidedContext {
		/** Where workers append the number-writes.json entries they used. */
		moneyGuardUsedFile: string;
	}
}

export default function setup(project: TestProject) {
	const dir = mkdtempSync(join(tmpdir(), "money-guard-"));
	const usedFile = join(dir, "used.txt");
	writeFileSync(usedFile, "");
	project.provide("moneyGuardUsedFile", usedFile);

	return () => {
		const used = new Set(readFileSync(usedFile, "utf8").split("\n"));
		rmSync(dir, { recursive: true, force: true });
		const ran = project.vitest.state.getFiles();
		const ranPaths = new Set(ran.map((f) => relative(REPO_ROOT, f.filepath)));
		const all = scanSources({ roots: ["src"], include: /\.pg\.test\.ts$/ });
		const full =
			process.env.PG_TEST_SEALED !== "1" &&
			ran.every((f) => f.result?.state === "pass") &&
			all.every((path) => ranPaths.has(relative(REPO_ROOT, path)));
		if (!full) return;
		const stale = Object.entries(allowed).flatMap(([column, files]) =>
			files
				.filter((file) => !used.has(`${column}\t${file}`))
				.map((file) => `${column}: ${file}`),
		);
		if (stale.length > 0)
			throw new Error(
				`src/test/money/number-writes.json has entries no write used; remove them (the list only shrinks):\n  ${stale.join("\n  ")}`,
			);
	};
}
