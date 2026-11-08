// Privilege ratchet for retrospend_app (access hardening plan, PR 2). The
// expectation file, retrospend-app-privileges.json, lists for every table what
// the app role may do: table privileges, row-level security and policies; plus
// the column-level privileges, the sequence privileges and the default
// privileges. It is read from the catalog of the migrated database, so any
// drift fails here: a new table, a widened grant, a dropped policy.
//
// A table made by a new migration shows up as "not in the expectation": grant
// the app role what it needs in that migration (never through default
// privileges or ON ALL TABLES), then add the table to the file with the same
// privileges. Never widen an entry to make this pass; narrow the migration.
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import expected from "./retrospend-app-privileges.json";
import {
	type DefaultAcl,
	type PrivilegeCatalog,
	readDefaultAcls,
	readPrivilegeCatalog,
} from "./privilege-catalog";

let client: Client;
let actual: PrivilegeCatalog;
let defaults: DefaultAcl[];

beforeAll(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	actual = await readPrivilegeCatalog(client);
	defaults = await readDefaultAcls(client);
});

afterAll(async () => {
	await client.end();
});

describe("retrospend_app privileges", () => {
	it("every table matches the checked-in expectation", () => {
		const names = new Set([
			...Object.keys(actual.tables),
			...Object.keys(expected.tables),
		]);
		const drift: string[] = [];
		for (const name of [...names].sort()) {
			const a = actual.tables[name];
			const e = (expected.tables as Record<string, unknown>)[name];
			if (!e) drift.push(`${name}: not in the expectation`);
			else if (!a) drift.push(`${name}: in the expectation but not a table`);
			else if (JSON.stringify(a) !== JSON.stringify(e))
				drift.push(
					`${name}: expected ${JSON.stringify(e)}, found ${JSON.stringify(a)}`,
				);
		}
		expect(drift).toEqual([]);
	});

	it("column privileges are exactly the expectation", () => {
		expect(actual.columns).toEqual(expected.columns);
	});

	it("never holds UPDATE on the user columns that decide who someone is", () => {
		const columns = actual.columns.user?.UPDATE ?? [];
		for (const forbidden of [
			"id",
			"role",
			"email",
			"emailVerified",
			"isActive",
			"username",
			"lastUsernameChangeAt",
			"twoFactorEnabled",
			"externalAiAllowed",
			"image",
			"createdAt",
		]) {
			expect(columns).not.toContain(forbidden);
		}
		// Never INSERT or DELETE on user, and no column-level INSERT either.
		expect(actual.tables.user?.privileges).toEqual(["SELECT"]);
		expect(actual.columns.user?.INSERT).toBeUndefined();
	});

	it("sequence privileges are exactly the expectation", () => {
		expect(actual.sequences).toEqual(expected.sequences);
	});

	it("PUBLIC holds nothing on any table or sequence", () => {
		expect(actual.publicTables).toEqual([]);
	});

	it("row-level security is on for user, with a read-all and an own-row update policy", async () => {
		expect(actual.tables.user?.rls).toBe(true);
		expect(actual.tables.user?.policies).toEqual([
			"user_select_all:SELECT",
			"user_update_own:UPDATE",
		]);
		const { rows } = await client.query<{ name: string; check: string }>(
			`SELECT polname AS name,
			        coalesce(pg_get_expr(polwithcheck, polrelid), '') AS check
			 FROM pg_policy WHERE polrelid = '"user"'::regclass AND polcmd = 'w'`,
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.check).toContain("current_setting('app.current_user_id'");
	});

	it("no default privilege grants anything to retrospend_app or PUBLIC", () => {
		const open = defaults
			.filter((d) => d.kind === "r" || d.kind === "S")
			.flatMap((d) =>
				d.entries
					.filter((e) => e.startsWith("PUBLIC:") || e.startsWith("retrospend_app:"))
					.map((e) => `${d.role} ${d.schema} ${d.kind} ${e}`),
			);
		expect(open).toEqual([]);

		// Functions: PUBLIC executes unless a default says otherwise, so every
		// role that owns tables must have a function row without PUBLIC.
		const functionRows = defaults.filter((d) => d.kind === "f");
		const granted = functionRows.flatMap((d) =>
			d.entries.filter(
				(e) => e.startsWith("PUBLIC:") || e.startsWith("retrospend_app:"),
			),
		);
		expect(granted).toEqual([]);
	});

	it("every role that owns tables has a default that keeps PUBLIC off new functions", async () => {
		const { rows: owners } = await client.query<{ role: string }>(
			`SELECT DISTINCT pg_get_userbyid(relowner)::text AS role
			 FROM pg_class
			 WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'`,
		);
		const covered = new Set(
			defaults.filter((d) => d.kind === "f").map((d) => d.role),
		);
		expect(owners.length).toBeGreaterThan(0);
		for (const owner of owners) expect(covered.has(owner.role)).toBe(true);
	});

	it("retrospend_app is not a member of any other role and cannot create objects", async () => {
		const { rows } = await client.query<{ role: string }>(
			`SELECT pg_get_userbyid(roleid)::text AS role
			 FROM pg_auth_members WHERE member = 'retrospend_app'::regrole`,
		);
		expect(rows).toEqual([]);
		const { rows: create } = await client.query<{ can: boolean }>(
			`SELECT has_schema_privilege('retrospend_app', 'public', 'CREATE') AS can`,
		);
		expect(create[0]?.can).toBe(false);
	});
});
