// Catches: a test that replays migration SQL on a connection that commits it,
// leaving the catalog changes for every later file in the worker.
// A pg test that replays a migration must do it inside a transaction that is
// rolled back (src/test/rolled-back-sql.ts). A replay that commits rewrites
// function grants, search_path, triggers and policies in the worker's database
// for every file that runs after it, so results depend on file order (one
// replay of budget_checkpoints put 19 functions back on `public` and failed
// the definer search_path test). This reads every test file that reads a
// migration.sql and fails on any call that passes that SQL to the database
// outside one of the helpers.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	scanSources,
	withoutComments,
	withoutCommentsAndStrings,
} from "./source-scan";
import { REPO_ROOT } from "./uiRules/paths";

const HELPERS = ["inRolledBackTransaction", "inRolledBackPrismaTransaction"];
// Calls that send SQL text to the database.
const SENDERS =
	/(?:\.query|\$executeRawUnsafe|\$queryRawUnsafe|\brunSql|\brun)\s*(?:<[^>()]*>)?\(/g;
// A file that reads migration SQL says so somewhere: the folder, the file name
// or a name that holds it. A path built from parts ("migration" + ".sql") still does.
const MENTIONS_MIGRATION = /migration|\.sql\b/i;

/** Index just past the bracket that closes the one opened at `open`. */
function closing(shape: string, open: number): number {
	const pairs: Record<string, string> = { "(": ")", "{": "}" };
	const opener = shape[open] ?? "";
	const closer = pairs[opener];
	let depth = 0;
	for (let i = open; i < shape.length; i++) {
		if (shape[i] === opener) depth++;
		else if (shape[i] === closer && --depth === 0) return i + 1;
	}
	return shape.length;
}

/** Index just past the body of an arrow function whose `=>` ends at `from`. */
function arrowBodyEnd(shape: string, from: number): number {
	let i = from;
	while (/\s/.test(shape[i] ?? "")) i++;
	if (shape[i] === "{") return closing(shape, i);
	// An expression body ends at a `;` or a line end outside any bracket.
	let depth = 0;
	for (; i < shape.length; i++) {
		const c = shape[i];
		if (c === "(" || c === "[" || c === "{") depth++;
		else if (c === ")" || c === "]" || c === "}") depth--;
		else if (depth <= 0 && (c === ";" || c === "\n")) return i;
	}
	return shape.length;
}

/**
 * Names that hold migration SQL, or something cut from it, or read it:
 * `const x = readFileSync(...)`, and functions, arrow functions and function
 * expressions whose body calls readFileSync.
 */
function migrationNames(shape: string): Set<string> {
	const names = new Set<string>();
	for (const m of shape.matchAll(
		/(?:const|let|var)\s+(\w+)\s*=\s*readFileSync\(/g,
	)) {
		if (m[1]) names.add(m[1]);
	}
	const bodyReads = (from: number, to: number) =>
		shape.slice(from, to).includes("readFileSync(");
	for (const m of shape.matchAll(/function\s+(\w+)\s*\([^)]*\)[^{]*\{/g)) {
		const open = (m.index ?? 0) + m[0].length - 1;
		if (m[1] && bodyReads(open, closing(shape, open))) names.add(m[1]);
	}
	// `const read = function () {...}`
	for (const m of shape.matchAll(
		/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function\b[^{]*\{/g,
	)) {
		const open = (m.index ?? 0) + m[0].length - 1;
		if (m[1] && bodyReads(open, closing(shape, open))) names.add(m[1]);
	}
	// `const read = (...parts: string[]) => readFileSync(...)`, with a block or an expression body.
	for (const m of shape.matchAll(
		/(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:\([^)]*\)|\w+)\s*(?::[^=]+?)?=>/g,
	)) {
		const bodyStart = (m.index ?? 0) + m[0].length;
		if (m[1] && bodyReads(bodyStart, arrowBodyEnd(shape, bodyStart))) {
			names.add(m[1]);
		}
	}
	// `const backfill = migration.slice(...)`: derived from a name we have.
	for (let changed = true; changed; ) {
		changed = false;
		for (const m of shape.matchAll(/(?:const|let)\s+(\w+)\s*=\s*([^;]+);/g)) {
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
	const code = withoutComments(source);
	if (!MENTIONS_MIGRATION.test(code)) return [];
	// Brackets and keywords in strings are not code: offsets match `code`.
	const shape = withoutCommentsAndStrings(source);
	const names = migrationNames(shape);
	if (names.size === 0) return [];

	const spans: [number, number][] = [];
	for (const helper of HELPERS) {
		for (const m of shape.matchAll(new RegExp(`\\b${helper}\\s*\\(`, "g"))) {
			const open = (m.index ?? 0) + m[0].length - 1;
			spans.push([open, closing(shape, open)]);
		}
	}
	const inside = (at: number) => spans.some(([a, b]) => at >= a && at < b);

	const found: string[] = [];
	for (const m of shape.matchAll(SENDERS)) {
		const start = m.index ?? 0;
		const open = start + m[0].length - 1;
		const args = shape.slice(open, closing(shape, open));
		const sendsMigration = [...names].some((n) =>
			new RegExp(`\\b${n}\\b`).test(args),
		);
		if (sendsMigration && !inside(start)) {
			found.push(code.slice(start, open + 40).replace(/\s+/g, " "));
		}
	}
	return found;
}

const testFiles = () =>
	scanSources({
		roots: ["src"],
		include: /\.test\.tsx?$/,
		// This file holds sample sources that look like replays.
		exclude: /[\\/]rolled-back-sql\.test\.ts$/,
	});

describe("migration replays in tests", () => {
	it("every replay runs inside a rolled-back transaction", () => {
		const offenders = testFiles().flatMap((file) =>
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

	it("catches a replay through an arrow function, with either kind of body", () => {
		const source = `
			const migrationSql = () => readFileSync(path + "/migration.sql", "utf8");
			const load = async (dir: string): Promise<string> => {
				return readFileSync(join(dir, "migration.sql"), "utf8");
			};
			const read = (...parts: string[]) =>
				readFileSync(join(root, ...parts), "utf8");
			const viaRead = read("prisma/migrations", name, "migration.sql");
			const viaFunctionExpression = function () { return readFileSync(path); };
			await client.query(migrationSql());
			await client.query(await load(dir));
			await client.query(viaRead);
			await client.query(viaFunctionExpression());`;
		expect(unsafeReplays(source)).toHaveLength(4);
	});

	it("catches a replay of a path that never spells migration.sql", () => {
		const source = `
			const FILE = "migration";
			const built = readFileSync(join(dir, \`\${FILE}.sql\`), "utf8");
			const listed = readFileSync(join(MIGRATIONS_DIR, folder, name), "utf8");
			await client.query(built);
			await client.query(listed);`;
		expect(unsafeReplays(source)).toHaveLength(2);
	});

	it("does not take a comment for code", () => {
		const source = `
			// reads migration.sql: await client.query(MIGRATION)
			const MIGRATION = readFileSync(fixturePath, "utf8");
			/* await client.query(MIGRATION); */`;
		expect(unsafeReplays(source)).toEqual([]);
		expect(
			unsafeReplays(`
				// migration.sql
				const sql = readFileSync(fixture);
				await client.query(sql);`),
		).toEqual([]);
	});

	it("does not take a bracket in a string for code", () => {
		const source = `
			const MIGRATION = readFileSync(join(root, "prisma/migrations/x/migration.sql"), "utf8");
			await inRolledBackTransaction(async (client) => {
				await client.query("SELECT '(' AS open");
			});
			await adminClient.query(MIGRATION);`;
		expect(unsafeReplays(source)).toHaveLength(1);
	});
});
