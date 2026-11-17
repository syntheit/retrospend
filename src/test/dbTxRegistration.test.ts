// Catches: a script or service registering its own client with db-tx.ts. The
// guard in userTransaction refuses any client db.ts did not build, because a
// bare PrismaClient has no sealing extension and would copy ciphertext as text
// or write plaintext. `registerClient` makes any object pass that guard, and
// `allowUnregisteredClientsForTests` switches it off, so each may be named only
// where listed here, with the reason. The lists are written by hand, not read
// from the code they guard (AGENTS.md 6.8). The scan covers every source root,
// scripts and apps included, and fails on a stale entry too.
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { scanSources, withoutComments } from "./source-scan";
import { REPO_ROOT } from "./uiRules/paths";

const REGISTER_CLIENT: Record<string, string> = {
	"src/server/db-tx.ts": "defines it",
	"src/server/db-core.ts":
		"registers the global and scoped clients it builds on the sealing extension",
	"src/server/db-tx.test.ts": "registers fake clients to unit-test the guard",
	"src/server/services/__tests__/category-name-index.pg.test.ts":
		"wraps a real test client to force an index race through userTransaction",
};

const ALLOW_UNREGISTERED: Record<string, string> = {
	"src/server/db-tx.ts": "defines it",
	"src/test/unit-env.ts": "unit tests pass fake clients; the pg suite refuses",
	"src/server/db-tx.test.ts": "tests both the allowed and the refused state",
};

const files = scanSources({
	roots: ["src", "scripts", "e2e", "prisma", "packages", "apps"],
	include: /\.(tsx?|mjs|cjs|js)$/,
}).map((file) => relative(REPO_ROOT, file));

const namers = (identifier: RegExp) =>
	files
		.filter((file) =>
			identifier.test(
				withoutComments(readFileSync(join(REPO_ROOT, file), "utf8")),
			),
		)
		.sort();

describe("db-tx registration", () => {
	it("registers a client only in the listed files", () => {
		expect(namers(/\bregisterClient\b/)).toEqual(
			Object.keys(REGISTER_CLIENT).sort(),
		);
	});

	it("lets unregistered clients through only in the listed files", () => {
		expect(namers(/\ballowUnregisteredClientsForTests\b/)).toEqual(
			Object.keys(ALLOW_UNREGISTERED).sort(),
		);
	});

	// A namespace import or a re-export names neither identifier, and would
	// reach both.
	it("never imports db-tx as a namespace or re-exports it", () => {
		expect(
			namers(
				/(?:import\s*\*\s*as\s+\w+|export\s*\*(?:\s*as\s+\w+)?)\s*from\s*["'][^"']*\/db-tx["']/,
			),
		).toEqual([]);
	});

	it("scans a non-trivial set of files", () => {
		expect(files.length).toBeGreaterThan(500);
		expect(files).toContain("src/server/db-tx.ts");
	});
});
