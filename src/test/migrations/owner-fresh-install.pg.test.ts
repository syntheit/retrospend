import { describe, expect, inject, it } from "vitest";
import { makeScratchProject } from "~/test/scratch-project";
import {
	neverHandedOver,
	ownerProblems,
	prepare,
} from "../../../scripts/db-owner/index.mjs";
import {
	connect,
	failureOf,
	migratorExists,
	ownerCanCreateIn,
	raceForCreate,
} from "../db-owner/helpers";

describe("the migration window on a brand-new install", () => {
	const scratch = inject("pgScratch");
	const scratch2 = inject("pgScratch2");
	const scratch3 = inject("pgScratch3");
	const quiet = { log: () => undefined, warn: () => undefined };
	/** A migration that needs CREATE on the database, as the first one and the keystore one did. */
	const window = (name: string, tag: string) => ({
		name,
		sql: `CREATE SCHEMA IF NOT EXISTS "public";
			CREATE SCHEMA IF NOT EXISTS keystore;
			CREATE SCHEMA a2_${tag}_schema;
			CREATE TABLE a2_${tag}_schema.probe (id integer);`,
	});
	/** What a retry can apply on an install that is no longer new: nothing needs CREATE. */
	const fixedSql = "CREATE TABLE public.a2_fixed (id integer);";

	it("is recognized from the catalogs, and migrates as a one-shot role while no session of the owner can get CREATE", async () => {
		const owner = await connect(scratch.ownerUrl);
		const admin = await connect(scratch.superUrl);
		try {
			expect(await neverHandedOver(admin)).toBe(true);
			// Outside the window the owner cannot, even for a schema that exists:
			// Postgres checks CREATE before IF NOT EXISTS.
			expect(await ownerCanCreateIn(scratch.superUrl)).toBe(false);
			expect(
				await failureOf(owner, 'CREATE SCHEMA IF NOT EXISTS "public"'),
			).toMatch(/permission denied for database/);

			const project = makeScratchProject({
				extra: [window("20300101000000_first", "first")],
			});
			// A session of the owner tries for CREATE, a schema and a trusted
			// extension, all through the start; it is refused every time. The
			// migrations get CREATE through a role of their own.
			const attacker = await connect(scratch.ownerUrl);
			const race = raceForCreate(attacker);
			try {
				await prepare(scratch.superUrl, { root: project.dir, ...quiet });
			} finally {
				project.cleanup();
			}
			const { attempts, wins } = await race.finish();
			await attacker.end();
			expect(attempts).toBeGreaterThan(1);
			expect(wins).toEqual([]);
			expect(await migratorExists(scratch.superUrl)).toBe(false);
			// The migrations created a schema, which needs CREATE: it was there.
			const { rows } = await owner.query<{ owner: string }>(
				"SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = 'a2_first_schema'",
			);
			expect(rows[0]?.owner).toBe("retrospend_owner");
			expect(await ownerCanCreateIn(scratch.superUrl)).toBe(false);
			expect(await ownerProblems(owner)).toEqual([]);
		} finally {
			await owner.end();
			await admin.end();
		}
	}, 120_000);

	it("is over after the first start: a pending migration that needs CREATE then fails", async () => {
		const owner = await connect(scratch.ownerUrl);
		const admin = await connect(scratch.superUrl);
		try {
			expect(await neverHandedOver(admin)).toBe(false);
			const project = makeScratchProject({
				extra: [
					window("20300101000000_first", "first"),
					{
						name: "20300102000000_needs_create",
						sql: "CREATE SCHEMA a2_needs_create;",
					},
				],
			});
			try {
				await expect(
					prepare(scratch.superUrl, { root: project.dir, ...quiet }),
				).rejects.toThrow(/Migration failed/);
			} finally {
				project.cleanup();
			}
			expect(await ownerCanCreateIn(scratch.superUrl)).toBe(false);
			const { rows } = await owner.query<{ n: string }>(
				"SELECT count(*) AS n FROM pg_namespace WHERE nspname = 'a2_needs_create'",
			);
			expect(rows[0]?.n).toBe("0");
		} finally {
			await owner.end();
			await admin.end();
		}
	}, 120_000);

	it("takes CREATE back when a later migration fails, and the P3009 recovery then applies the fixed one without it", async () => {
		const owner = await connect(scratch2.ownerUrl);
		const admin = await connect(scratch2.superUrl);
		const good = window("20300101000000_second", "second");
		const bad = { name: "20300102000000_breaks", sql: "SELECT 1 / 0;" };
		const project = makeScratchProject({ extra: [good, bad] });
		try {
			expect(await neverHandedOver(admin)).toBe(true);
			await expect(
				prepare(scratch2.superUrl, { root: project.dir, ...quiet }),
			).rejects.toThrow(/Migration failed/);
			// Revoked although the migration failed.
			expect(await ownerCanCreateIn(scratch2.superUrl)).toBe(false);
			expect(await ownerProblems(owner)).toEqual([]);
			// The install has been through a first start: not new any more.
			expect(await neverHandedOver(admin)).toBe(false);

			// Same behavior as the entrypoint had: the failed migration is marked
			// rolled back and the (fixed) migration is tried again.
			project.writeMigration(bad.name, fixedSql);
			const messages: string[] = [];
			await prepare(scratch2.superUrl, {
				root: project.dir,
				log: (message) => messages.push(message),
				warn: () => undefined,
			});
			expect(messages.join("\n")).toContain(
				`Found failed migration: ${bad.name}`,
			);
			expect(messages).toContain(
				"Database migrations applied successfully after rollback!",
			);
			const { rows } = await owner.query<{ owner: string }>(
				"SELECT pg_get_userbyid(relowner) AS owner FROM pg_class WHERE oid = 'public.a2_fixed'::regclass",
			);
			expect(rows[0]?.owner).toBe("retrospend_owner");
			expect(await ownerCanCreateIn(scratch2.superUrl)).toBe(false);
		} finally {
			project.cleanup();
			await owner.end();
			await admin.end();
		}
	}, 180_000);

	it("a migration may change its text once applied: Prisma deploy does not compare checksums", async () => {
		// The keystore migration was edited (CREATE SCHEMA IF NOT EXISTS became a
		// guarded DO block) after it had been applied on a development database.
		// Here the migration applied by the test above is edited and deployed.
		const project = makeScratchProject({
			extra: [
				window("20300101000000_second", "second"),
				{
					name: "20300102000000_breaks",
					sql: `${fixedSql}\n-- edited after it was applied`,
				},
			],
		});
		try {
			await expect(
				prepare(scratch2.superUrl, { root: project.dir, ...quiet }),
			).resolves.toBeDefined();
		} finally {
			project.cleanup();
		}
	}, 120_000);

	it("does not retry a first migration that failed as a new install: the documented reset is to drop the database and create it empty", async () => {
		const admin = await connect(scratch3.superUrl);
		const first = {
			name: "20300101000000_first",
			sql: `${window("x", "third").sql}\nSELECT 1 / 0;`,
		};
		const project = makeScratchProject({ extra: [first] });
		try {
			expect(await neverHandedOver(admin)).toBe(true);
			await expect(
				prepare(scratch3.superUrl, { root: project.dir, ...quiet }),
			).rejects.toThrow(/Migration failed/);
			expect(await ownerCanCreateIn(scratch3.superUrl)).toBe(false);
			// The one-shot role is gone and what it made belongs to the owner.
			expect(await migratorExists(scratch3.superUrl)).toBe(false);
			const { rows: held } = await admin.query<{
				name: string;
				owner: string;
			}>(`
				SELECT nspname AS name, pg_get_userbyid(nspowner) AS owner FROM pg_namespace
				 WHERE nspname IN ('public', 'keystore', 'a2_third_schema') ORDER BY 1`);
			expect(held).toEqual([
				{ name: "a2_third_schema", owner: "retrospend_owner" },
				{ name: "keystore", owner: "retrospend_owner" },
				{ name: "public", owner: "retrospend_owner" },
			]);
			// No marker keeps it new: the first migration, fixed, is refused with
			// the way out in the message.
			expect(await neverHandedOver(admin)).toBe(false);
			project.writeMigration(first.name, window("x", "third").sql);
			await expect(
				prepare(scratch3.superUrl, { root: project.dir, ...quiet }),
			).rejects.toThrow(/drop the database and create it again empty/);
			expect(await ownerCanCreateIn(scratch3.superUrl)).toBe(false);
		} finally {
			project.cleanup();
			await admin.end();
		}
	}, 180_000);

	it("gives a concurrent owner session no CREATE although the owner emptied public and left a payload in keystore", async () => {
		// The attack: the owner plants a function in keystore (which it owns) and
		// drops everything in public, so that public looks new. If the next
		// start then gave the owner CREATE, a second owner session could race the
		// migrations for it and CREATE SCHEMA zz; CREATE EXTENSION hstore WITH
		// SCHEMA zz (a trusted extension, its script runs as the superuser).
		const owner = await connect(scratch3.ownerUrl);
		const attacker = await connect(scratch3.ownerUrl);
		const admin = await connect(scratch3.superUrl);
		try {
			await owner.query(`
				DROP SCHEMA IF EXISTS a2_third_schema CASCADE;
				DROP TABLE IF EXISTS public._prisma_migrations;
				CREATE FUNCTION keystore.a2_payload() RETURNS trigger LANGUAGE plpgsql AS $f$
				BEGIN RETURN NEW; END $f$`);
			// Public is empty, and the catalogs still say it is not new.
			const { rows: left } = await owner.query<{ n: string }>(`
				SELECT count(*) AS n FROM pg_class
				 WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'v', 'S')`);
			expect(left[0]?.n).toBe("0");
			expect(await neverHandedOver(admin)).toBe(false);

			// The control: given CREATE, the attacker session does create a schema,
			// so a refusal below means something.
			const { rows: named } = await admin.query<{ name: string }>(
				"SELECT quote_ident(current_database()) AS name",
			);
			await admin.query(
				`GRANT CREATE ON DATABASE ${named[0]?.name} TO retrospend_owner`,
			);
			try {
				await attacker.query("CREATE SCHEMA a2_control");
				await attacker.query("DROP SCHEMA a2_control");
			} finally {
				await admin.query(
					`REVOKE CREATE ON DATABASE ${named[0]?.name} FROM retrospend_owner`,
				);
			}

			const race = raceForCreate(attacker);
			const project = makeScratchProject({
				extra: [window("20300101000000_first", "again")],
			});
			try {
				await expect(
					prepare(scratch3.superUrl, { root: project.dir, ...quiet }),
				).rejects.toThrow(/Migration failed/);
			} finally {
				project.cleanup();
			}
			const { attempts, wins } = await race.finish();
			expect(attempts).toBeGreaterThan(1);
			expect(wins).toEqual([]);
			const { rows } = await owner.query<{
				schemas: string;
				extensions: string;
			}>(`
				SELECT (SELECT count(*) FROM pg_namespace WHERE nspname = 'a2_zz') AS schemas,
				       (SELECT count(*) FROM pg_extension WHERE extname = 'hstore') AS extensions`);
			expect(rows[0]).toEqual({ schemas: "0", extensions: "0" });
		} finally {
			await owner.end();
			await attacker.end();
			await admin.end();
		}
	}, 120_000);
});
