/**
 * The restore steps in docs/self-hosting.md ("Data key backups"), run for real:
 * the sidecar's two pg_dump commands, then pg_restore into a fresh database and
 * in place over a populated one. Needs pg_dump and pg_restore on PATH.
 *
 * Hand-derived expectations, two users A and B with one key each:
 *
 *   main dump        -> no keystore table, has the keystore migration row
 *   keystore dump    -> only the keystore schema
 *   fresh restore    -> main first: no keystore, deleting a user still works;
 *                       then the keystore dump: both keys, no app role access
 *   orphan sweep     -> B was deleted before the keystore dump came back, so
 *                       B's key goes and A's stays
 *   in place restore -> `--clean` succeeds for both dumps (no foreign key
 *                       from keystore to "user" to block dropping "user")
 */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { Keyring } from "~/server/crypto/field-crypto";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { getOrCreateDataKeyring } from "./data-key.service";

const sourceUrl = () => {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error("DATABASE_URL is not set");
	return url;
};

/**
 * A pg_dump newer than the test server writes `SET transaction_timeout`, which
 * an older server rejects; pg_restore reports it and goes on. That one error is
 * the only one allowed through.
 */
const ignorable = /transaction_timeout|errors ignored on restore: 1$/;

function sh(bin: string, args: string[]) {
	const result = spawnSync(bin, args, { encoding: "utf8" });
	if (result.error) throw result.error;
	const problems = result.stderr
		.split("\n")
		.filter((line) => /error:|Command was/.test(line) || line.startsWith("pg_dump:"))
		.filter((line) => !ignorable.test(line) && !line.startsWith("Command was: SET "));
	if (result.status !== 0 && problems.length > 0)
		throw new Error(`${bin} failed: ${result.stderr}`);
	if (result.status !== 0 && bin === "pg_dump")
		throw new Error(`${bin} failed: ${result.stderr}`);
	return result.stdout;
}

/** The flags the sidecar passes (sidecar/tasks/backup_age.go pgDumpArgs). */
const dumpArgs = (url: string, file: string, schema: string[]) => [
	"--format=custom",
	"--no-owner",
	"--no-privileges",
	...schema,
	`--dbname=${url}`,
	`--file=${file}`,
];

async function withScratch(
	run: (url: string, query: Client["query"]) => Promise<void>,
) {
	const name = `${new URL(sourceUrl()).pathname.slice(1)}_rs${randomBytes(2).toString("hex")}`;
	const url = new URL(sourceUrl());
	url.pathname = `/${name}`;
	await adminDb.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
	const client = new Client({ connectionString: url.toString() });
	try {
		await client.connect();
		await run(url.toString(), client.query.bind(client));
	} finally {
		await client.end().catch(() => undefined);
		await adminDb.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
	}
}

describe("restoring the main dump and the keystore dump", () => {
	it("works into a fresh database and in place", async () => {
		const dir = mkdtempSync(join(tmpdir(), "keystore-restore-"));
		try {
			const master = new Keyring([{ id: 1, key: randomBytes(32) }]);
			const [a, b] = await Promise.all([createTestUser(), createTestUser()]);
			await getOrCreateDataKeyring(a.user.id, master);
			await getOrCreateDataKeyring(b.user.id, master);

			const mainDump = join(dir, "main.dump");
			const keysDump = join(dir, "keystore.dump");
			sh("pg_dump", dumpArgs(sourceUrl(), mainDump, ["--exclude-schema=keystore"]));
			sh("pg_dump", dumpArgs(sourceUrl(), keysDump, ["--schema=keystore"]));
			expect(sh("pg_restore", ["--list", mainDump])).not.toContain("user_data_key");
			expect(sh("pg_restore", ["--list", keysDump])).toContain("user_data_key");
			expect(sh("pg_restore", ["--list", keysDump])).not.toMatch(/TABLE public user /);

			const restore = (url: string, file: string, clean: boolean) =>
				sh("pg_restore", [
					"--no-owner",
					...(clean ? ["--clean", "--if-exists"] : []),
					`--dbname=${url}`,
					file,
				]);
			const keyOwners = async (query: Client["query"]) =>
				(
					await query<{ userId: string }>(
						'SELECT "userId" FROM keystore."user_data_key" ORDER BY "userId"',
					)
				).rows.map((row) => row.userId);

			await withScratch(async (url, query) => {
				// Fresh database: main dump first.
				restore(url, mainDump, false);
				expect(
					(await query("SELECT to_regclass('keystore.user_data_key') AS t")).rows[0].t,
				).toBeNull();
				// Prod would still list the keystore migration as applied here.
				expect(
					(
						await query(
							"SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261109100000_keystore'",
						)
					).rowCount,
				).toBe(1);
				// A user can still be deleted with no keystore.
				await query('DELETE FROM "user" WHERE id = $1', [b.user.id]);

				// Then the keystore dump, as the docs say, and the orphan sweep.
				restore(url, keysDump, false);
				expect(await keyOwners(query)).toContain(b.user.id);
				await query(
					'DELETE FROM keystore."user_data_key" k WHERE NOT EXISTS (SELECT 1 FROM public."user" u WHERE u.id = k."userId")',
				);
				const owners = await keyOwners(query);
				expect(owners).toContain(a.user.id);
				expect(owners).not.toContain(b.user.id);

				const access = (
					await query(
						`SELECT has_schema_privilege('retrospend_app', 'keystore', 'USAGE') AS usage,
						        has_table_privilege('retrospend_app', 'keystore.user_data_key', 'SELECT') AS read,
						        (SELECT relrowsecurity FROM pg_class WHERE oid = 'keystore.user_data_key'::regclass) AS rls`,
					)
				).rows[0];
				expect(access).toEqual({ usage: false, read: false, rls: true });

				// The restored database keeps the cascade.
				await query('DELETE FROM "user" WHERE id = $1', [a.user.id]);
				expect(await keyOwners(query)).not.toContain(a.user.id);

				// In place over a populated database: both restores succeed.
				restore(url, mainDump, true);
				restore(url, keysDump, true);
				expect(
					(await query('SELECT 1 FROM "user" WHERE id = $1', [b.user.id])).rowCount,
				).toBe(1);
				expect(await keyOwners(query)).toEqual(
					[a.user.id, b.user.id].sort(),
				);
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}, 120_000);
});
