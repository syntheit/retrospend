/**
 * Migration 20261127300000_category_owner_policy: the owner alone writes a
 * category, the shared-expense clause only reads. The catalog test reads the
 * policies from the database, never the migration's text. The rollback tests
 * run the snippet twice and migrate forward again, and check it leaves
 * 20261127200000_category_version alone (and the version rollback leaves this
 * one alone).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { adminDb } from "~/test/pg-harness";
import { inRolledBackTransaction } from "~/test/rolled-back-sql";
import { REPO_ROOT } from "~/test/uiRules/paths";

const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");
const NAME = "20261127300000_category_owner_policy";
const VERSION = "20261127200000_category_version";
const FN = "is_category_in_user_shared_transaction";

type Q = { query: (sql: string) => Promise<{ rows: Record<string, unknown>[] }> };

const SQL_POLICIES = `
	SELECT policyname AS name, cmd, qual, with_check AS "withCheck"
	FROM pg_policies WHERE schemaname = 'public' AND tablename = 'category'
	ORDER BY policyname`;

const usesShared = (text: unknown) => String(text ?? "").includes(FN);

describe("the category policies in the catalog", () => {
	it("category_isolation is the owner's alone for every command and the shared clause only reads", async () => {
		const rows = await adminDb.$queryRawUnsafe<
			{ name: string; cmd: string; qual: string; withCheck: string }[]
		>(SQL_POLICIES);
		expect(rows.map((r) => [r.name, r.cmd])).toEqual([
			["category_isolation", "ALL"],
			["category_shared_read", "SELECT"],
		]);
		const [isolation, shared] = rows;
		expect(usesShared(isolation?.qual)).toBe(false);
		expect(usesShared(isolation?.withCheck)).toBe(false);
		expect(String(isolation?.withCheck)).toContain("userId");
		expect(usesShared(shared?.qual)).toBe(true);
	});
});

const state = async (client: Q) => {
	const policies = (await client.query(SQL_POLICIES)).rows;
	const one = async (sql: string) =>
		(await client.query(sql)).rows[0]?.n as number;
	return {
		policies: policies.map((p) => `${p.name}:${p.cmd}`),
		isolationReadsShared: usesShared(policies[0]?.qual),
		record: await one(
			`SELECT count(*)::int AS n FROM _prisma_migrations WHERE migration_name = '${NAME}'`,
		),
		versionRecord: await one(
			`SELECT count(*)::int AS n FROM _prisma_migrations WHERE migration_name = '${VERSION}'`,
		),
		versionTrigger: await one(
			`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'category_version_moves'`,
		),
	};
};

describe("the rollback snippet", () => {
	it("restores the old policy, twice, and the migration brings the new one back, twice", async () => {
		const snippet = read(`prisma/rollback/${NAME}.sql`);
		const migration = read(`prisma/migrations/${NAME}/migration.sql`);
		await inRolledBackTransaction(async (client) => {
			expect(await state(client)).toMatchObject({
				policies: ["category_isolation:ALL", "category_shared_read:SELECT"],
				isolationReadsShared: false,
				record: 1,
			});
			await client.query(snippet);
			await client.query(snippet);
			expect(await state(client)).toMatchObject({
				policies: ["category_isolation:ALL"],
				isolationReadsShared: true,
				record: 0,
			});
			await client.query(migration);
			await client.query(migration);
			expect(await state(client)).toMatchObject({
				policies: ["category_isolation:ALL", "category_shared_read:SELECT"],
				isolationReadsShared: false,
				record: 0,
			});
		});
	}, 120_000);

	it("leaves the category version migration alone, and its rollback leaves this one alone", async () => {
		await inRolledBackTransaction(async (client) => {
			const snippet = read(`prisma/rollback/${NAME}.sql`);
			await client.query(snippet);
			await client.query(snippet);
			expect(await state(client)).toMatchObject({
				versionRecord: 1,
				versionTrigger: 1,
			});
		});
		await inRolledBackTransaction(async (client) => {
			const snippet = read(`prisma/rollback/${VERSION}.sql`);
			await client.query(snippet);
			await client.query(snippet);
			expect(await state(client)).toMatchObject({
				policies: ["category_isolation:ALL", "category_shared_read:SELECT"],
				record: 1,
			});
		});
	}, 120_000);
});
