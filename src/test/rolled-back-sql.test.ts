// A pg test that replays a migration must do it inside a transaction that is
// rolled back (src/test/rolled-back-sql.ts). A replay that commits rewrites
// function grants, search_path, triggers and policies in the worker's database
// for every file that runs after it, so results depend on file order (one
// replay of budget_checkpoints put 19 functions back on `public` and failed
// the definer search_path test). This reads every test file that reads a
// migration.sql and fails on any call that passes that SQL to the database
// outside one of the helpers.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./uiRules/paths";

const SELF = "rolled-back-sql.test.ts";
const HELPERS = ["inRolledBackTransaction", "inRolledBackPrismaTransaction"];
// Calls that send SQL text to the database.
const SENDERS =
	/(?:\.query|\$executeRawUnsafe|\$queryRawUnsafe|\brunSql|\brun)\s*(?:<[^>()]*>)?\(/g;

/** Index just past the bracket that closes the one opened at `open`. */
function closing(source: string, open: number): number {
	const pairs: Record<string, string> = { "(": ")", "{": "}" };
	const opener = source[open] ?? "";
	const closer = pairs[opener];
	let depth = 0;
	for (let i = open; i < source.length; i++) {
		if (source[i] === opener) depth++;
		else if (source[i] === closer && --depth === 0) return i + 1;
	}
	return source.length;
}

/** Names that hold migration SQL, or something cut from it. */
function migrationNames(source: string): Set<string> {
	const names = new Set<string>();
	for (const m of source.matchAll(
		/(?:const|let|var)\s+(\w+)\s*=\s*readFileSync\(/g,
	)) {
		if (m[1]) names.add(m[1]);
	}
	for (const m of source.matchAll(/function\s+(\w+)\s*\([^)]*\)[^{]*\{/g)) {
		const open = (m.index ?? 0) + m[0].length - 1;
		if (source.slice(open, closing(source, open)).includes("readFileSync(")) {
			if (m[1]) names.add(m[1]);
		}
	}
	// `const backfill = migration.slice(...)`: derived from a name we have.
	for (let changed = true; changed; ) {
		changed = false;
		for (const m of source.matchAll(/(?:const|let)\s+(\w+)\s*=\s*([^;]+);/g)) {
			const [, name, expression] = m;
			if (!name || !expression || names.has(name)) continue;
			if ([...names].some((n) => new RegExp(`\\b${n}\\b`).test(expression))) {
				names.add(name);
				changed = true;
			}
		}
	}
	return names;
}

/** The calls in `source` that send migration SQL outside a rollback helper. */
function unsafeReplays(source: string): string[] {
	if (!source.includes("migration.sql")) return [];
	const names = migrationNames(source);
	if (names.size === 0) return [];

	const spans: [number, number][] = [];
	for (const helper of HELPERS) {
		for (const m of source.matchAll(new RegExp(`\\b${helper}\\s*\\(`, "g"))) {
			const open = (m.index ?? 0) + m[0].length - 1;
			spans.push([open, closing(source, open)]);
		}
	}
	const inside = (at: number) => spans.some(([a, b]) => at >= a && at < b);

	const found: string[] = [];
	for (const m of source.matchAll(SENDERS)) {
		const start = m.index ?? 0;
		const open = start + m[0].length - 1;
		const args = source.slice(open, closing(source, open));
		const sendsMigration = [...names].some((n) =>
			new RegExp(`\\b${n}\\b`).test(args),
		);
		if (sendsMigration && !inside(start)) {
			found.push(source.slice(start, open + 40).replace(/\s+/g, " "));
		}
	}
	return found;
}

function testFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			return ["node_modules", "generated"].includes(entry.name)
				? []
				: testFiles(path);
		}
		// This file holds sample sources that look like replays.
		return /\.test\.tsx?$/.test(entry.name) && entry.name !== SELF
			? [path]
			: [];
	});
}

describe("migration replays in tests", () => {
	it("every replay runs inside a rolled-back transaction", () => {
		const offenders = testFiles(join(REPO_ROOT, "src")).flatMap((file) =>
			unsafeReplays(readFileSync(file, "utf8")).map(
				(call) => `${file.slice(REPO_ROOT.length + 1)}: ${call}`,
			),
		);
		expect(offenders).toEqual([]);
	});

	it("catches a replay that commits", () => {
		const source = `
			const MIGRATION = readFileSync(join(root, "prisma/migrations/x/migration.sql"), "utf8");
			it("replays", async () => {
				const client = new Client({ connectionString });
				await client.query(MIGRATION);
			});`;
		expect(unsafeReplays(source)).toHaveLength(1);
	});

	it("catches a replay through a function, a slice or a raw call", () => {
		const source = `
			function migrationSql() { return readFileSync(path + "/migration.sql", "utf8"); }
			const migration = readFileSync(path + "/migration.sql", "utf8");
			const backfill = migration.slice(migration.indexOf("UPDATE"));
			await client.query(migrationSql());
			await adminDb.$executeRawUnsafe(backfill);
			await runSql(migration);`;
		expect(unsafeReplays(source)).toHaveLength(3);
	});

	it("accepts a replay inside either helper", () => {
		const source = `
			const MIGRATION = readFileSync(join(root, "prisma/migrations/x/migration.sql"), "utf8");
			await inRolledBackTransaction(async (client) => {
				await client.query(MIGRATION);
			});
			await inRolledBackPrismaTransaction(async (tx, run) => {
				await run(MIGRATION);
			});`;
		expect(unsafeReplays(source)).toEqual([]);
	});

	it("leaves a test that only reads the migration text", () => {
		const source = `
			const sql = readFileSync(join(root, "prisma/migrations/x/migration.sql"), "utf8");
			expect(sql).toContain("HAVING COUNT(*) > 1");
			expect(sql.slice(sql.indexOf("GROUP BY"))).toBeTruthy();`;
		expect(unsafeReplays(source)).toEqual([]);
	});
});
