// A pending migration must not need CREATE on the database. The migration role
// (retrospend_owner) holds it only on a brand-new install, while the migrations
// run; an upgrade never gets it, because whatever the owner has planted in its
// own objects (a view, a trigger) runs during the migrations, and with CREATE it
// could install a trusted extension into a schema it controls, whose install
// script runs as the superuser (scripts/db-owner, prisma/bootstrap).
//
// Postgres checks CREATE on the database for CREATE SCHEMA and CREATE
// EXTENSION even with IF NOT EXISTS and even when the object exists. So in a
// migration newer than the last one in applied.json (the ones that have shipped
// are what they are), both statements are allowed only as a plain statement
// inside a DO block that first checks the catalog and finds the object missing.
// A schema or extension a migration needs goes into prisma/bootstrap/owner-role.sql,
// which creates it before the migrations run; the guarded statement is then
// never reached on an upgrade.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../uiRules/paths";
import applied from "./applied.json";

/** Comments out of the way: `--` to the end of the line, and block comments. */
function withoutComments(sql: string): string {
	return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

/** Statements that need CREATE on the database and are not in a guarded DO block. */
function unguardedDatabaseCreates(sql: string): string[] {
	const text = withoutComments(sql);
	const blocks = [...text.matchAll(/\bDO\s+\$(\w*)\$([\s\S]*?)\$\1\$/gi)].map(
		(m) => ({
			start: m.index ?? 0,
			end: (m.index ?? 0) + m[0].length,
			body: m[2] ?? "",
		}),
	);
	const found: string[] = [];
	for (const m of text.matchAll(
		/\bCREATE\s+(SCHEMA|EXTENSION)\b(\s+IF\s+NOT\s+EXISTS)?[^;]*/gi,
	)) {
		const at = m.index ?? 0;
		const kind = (m[1] ?? "").toUpperCase();
		const statement = m[0].replace(/\s+/g, " ").trim();
		const block = blocks.find((b) => at >= b.start && at < b.end);
		const catalog = kind === "SCHEMA" ? "pg_namespace" : "pg_extension";
		const guarded =
			block !== undefined &&
			!m[2] &&
			new RegExp(
				`IF\\s+NOT\\s+EXISTS\\s*\\(\\s*SELECT[^;]*${catalog}`,
				"i",
			).test(block.body);
		if (!guarded) found.push(statement);
	}
	for (const m of text.matchAll(/\bALTER\s+SCHEMA\s+\S+\s+RENAME\b[^;]*/gi)) {
		found.push(m[0].replace(/\s+/g, " ").trim());
	}
	return found;
}

describe("unguardedDatabaseCreates", () => {
	it("flags a plain CREATE SCHEMA or CREATE EXTENSION, with or without IF NOT EXISTS", () => {
		expect(unguardedDatabaseCreates("CREATE SCHEMA keystore;")).toEqual([
			"CREATE SCHEMA keystore",
		]);
		expect(
			unguardedDatabaseCreates("CREATE SCHEMA IF NOT EXISTS keystore;"),
		).toEqual(["CREATE SCHEMA IF NOT EXISTS keystore"]);
		expect(
			unguardedDatabaseCreates("create extension if not exists hstore;"),
		).toHaveLength(1);
	});

	it("flags one inside a DO block that does not check the catalog, or that keeps IF NOT EXISTS", () => {
		expect(
			unguardedDatabaseCreates("DO $$ BEGIN CREATE SCHEMA keystore; END $$;"),
		).toHaveLength(1);
		expect(
			unguardedDatabaseCreates(
				"DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'k') THEN CREATE SCHEMA IF NOT EXISTS k; END IF; END $$;",
			),
		).toHaveLength(1);
		// The wrong catalog for the statement.
		expect(
			unguardedDatabaseCreates(
				"DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'k') THEN CREATE SCHEMA k; END IF; END $$;",
			),
		).toHaveLength(1);
	});

	it("flags a schema rename, and ignores comments", () => {
		expect(
			unguardedDatabaseCreates("ALTER SCHEMA a RENAME TO b;"),
		).toHaveLength(1);
		expect(
			unguardedDatabaseCreates(
				"-- CREATE SCHEMA x;\n/* CREATE EXTENSION y; */",
			),
		).toEqual([]);
	});

	it("allows the guarded form", () => {
		expect(
			unguardedDatabaseCreates(`DO $$
				BEGIN
				  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'keystore') THEN
				    CREATE SCHEMA keystore;
				  END IF;
				END
				$$;`),
		).toEqual([]);
		expect(
			unguardedDatabaseCreates(`DO $mig$ BEGIN
				IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'hstore') THEN
				  CREATE EXTENSION hstore WITH SCHEMA public;
				END IF; END $mig$;`),
		).toEqual([]);
	});
});

describe("migrations newer than the last one in applied.json", () => {
	const shipped = Object.keys(applied.applied).sort();
	const last = shipped.at(-1) as string;
	const pending = readdirSync(join(REPO_ROOT, "prisma/migrations"), {
		withFileTypes: true,
	})
		.filter((entry) => entry.isDirectory() && entry.name > last)
		.map((entry) => entry.name)
		.sort();

	it("is a real set to scan", () => {
		expect(last).toBeTruthy();
		expect(pending.length).toBeGreaterThan(0);
	});

	for (const name of pending) {
		it(`${name} needs no CREATE on the database`, () => {
			const sql = readFileSync(
				join(REPO_ROOT, "prisma/migrations", name, "migration.sql"),
				"utf8",
			);
			expect(unguardedDatabaseCreates(sql)).toEqual([]);
		});
	}
});
