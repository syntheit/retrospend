// A migration must not hand retrospend_app or PUBLIC a blanket grant: every
// table, function and sequence a migration grants on is named. 20260309000000
// once re-granted every table to retrospend_app and undid the per-table
// revokes before it. Applied migrations cannot change, so the two that
// already do it are listed by name; any other migration, new or old, fails.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../uiRules/paths";

const MIGRATIONS = join(REPO_ROOT, "prisma/migrations");

// Applied before this rule existed. Do not add to this list.
const LEGACY = new Set([
	"20260303000001_security_rls",
	"20260309000000_fix_retrospend_app_schema_usage",
]);

/** The statements of a SQL file, without comments. */
function statements(sql: string): string[] {
	return sql
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/--[^\n]*/g, " ")
		.split(";");
}

/**
 * True for `GRANT ... ON ALL TABLES|SEQUENCES|FUNCTIONS|ROUTINES|PROCEDURES IN
 * SCHEMA ... TO ... retrospend_app|PUBLIC`. REVOKE statements and grants to
 * other roles do not match.
 */
function isBlanketGrant(statement: string): boolean {
	return /\bGRANT\b[^]*\bON\s+ALL\s+(TABLES|SEQUENCES|FUNCTIONS|ROUTINES|PROCEDURES)\b[^]*\bTO\b[^]*\b(retrospend_app|PUBLIC)\b/i.test(
		statement,
	);
}

function offenders(): string[] {
	return readdirSync(MIGRATIONS, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort()
		.filter((folder) =>
			statements(
				readFileSync(join(MIGRATIONS, folder, "migration.sql"), "utf8"),
			).some(isBlanketGrant),
		);
}

describe("blanket grants in migrations", () => {
	it("only the legacy migrations grant on ALL tables, sequences or functions", () => {
		expect(offenders().filter((folder) => !LEGACY.has(folder))).toEqual([]);
	});

	it("the legacy list is exactly the migrations that still do", () => {
		// A stale name would let a rename slip past the scan.
		expect(offenders().filter((folder) => LEGACY.has(folder))).toEqual(
			[...LEGACY].sort(),
		);
	});

	it("recognizes the grants it is meant to catch", () => {
		for (const sql of [
			"GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO retrospend_app",
			"grant all on all sequences in schema public to PUBLIC",
			"GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public\n  TO retrospend_app",
			"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO \"retrospend_app\"",
		]) {
			expect(isBlanketGrant(sql), sql).toBe(true);
		}
	});

	it("leaves named grants, revokes and other roles alone", () => {
		for (const sql of [
			'GRANT SELECT, INSERT ON "budget_dirty" TO retrospend_app',
			"GRANT EXECUTE ON FUNCTION is_budget_member(TEXT, TEXT) TO retrospend_app",
			"REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC",
			"GRANT SELECT ON ALL TABLES IN SCHEMA public TO reporting",
			"ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO retrospend_app",
		]) {
			expect(isBlanketGrant(sql), sql).toBe(false);
		}
	});

	it("ignores a grant that only appears in a comment", () => {
		const sql = "-- GRANT SELECT ON ALL TABLES IN SCHEMA public TO retrospend_app\nSELECT 1";
		expect(statements(sql).some(isBlanketGrant)).toBe(false);
	});
});
