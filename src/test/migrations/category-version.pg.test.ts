/**
 * category.version (migration 20261127200000_category_version). The catalog
 * tests build their lists from the schema and the trigger function in the
 * database, never from the migration's own text (AGENTS 6.8): the function
 * must name exactly CATEGORY_VERSION_COLUMNS, and every scalar column of
 * Category sits in exactly one of that list and CATEGORY_VERSION_SKIPPED. The
 * behavior tests write each column in turn, as the owner and as the app role.
 * The rollback tests run the snippet twice and migrate forward again.
 *
 * Hand-derived: a new category is version 0. A changed color, icon or
 * excludeByDefault is OLD + 1 unless the writer already moved the version
 * above OLD (then its value stays). A write below OLD is refused. The name,
 * the name index, the kind and isFixed never move it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	CATEGORY_VERSION_COLUMNS,
	CATEGORY_VERSION_SKIPPED,
	type CategoryVersionColumn,
	type CategoryVersionSkipped,
} from "@retrospend/domain/category-version";
import { describe, expect, it } from "vitest";
import { createUserScopedDb } from "~/server/db";
import { adminDb, createTestUser, fixtureDb } from "~/test/pg-harness";
import { readSchema } from "~/test/prisma-schema";
import { inRolledBackTransaction } from "~/test/rolled-back-sql";
import { REPO_ROOT } from "~/test/uiRules/paths";
import type { Prisma } from "~prisma";

const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");
const NAME = "20261127200000_category_version";
const STAMPS = "20261126100000_stamps_always_move";
const ACCOUNTS = "20261127100000_account_version";
const FN = "category_version_moves";

const model = readSchema().find((m) => m.name === "Category");
const modelNames = new Set(readSchema().map((m) => m.name));
/** The scalar columns of Category: no list, no relation. */
const columns = (model?.fields ?? [])
	.filter((f) => !f.list && !modelNames.has(f.type))
	.map((f) => f.name);

const functionSource = async () => {
	const [fn] = await adminDb.$queryRaw<{ src: string }[]>`
		SELECT prosrc AS src FROM pg_proc
		WHERE proname = ${FN} AND pronamespace = 'public'::regnamespace`;
	return fn?.src ?? "";
};

describe("which columns move the version", () => {
	it("the function names exactly CATEGORY_VERSION_COLUMNS, on the old and the new side", async () => {
		const src = await functionSource();
		const named = (side: "OLD" | "NEW") =>
			[
				...new Set(
					[...src.matchAll(new RegExp(`${side}\\."(\\w+)"`, "g"))]
						.map((m) => m[1] as string)
						.filter((c) => c !== "version"),
				),
			].sort();
		const expected = [...CATEGORY_VERSION_COLUMNS].sort();
		expect(named("OLD")).toEqual(expected);
		expect(named("NEW")).toEqual(expected);
	});

	it("every scalar column of the schema is in exactly one of the two lists, and no list names a column that is gone", () => {
		expect(columns.length).toBeGreaterThan(8);
		const versioned = new Set<string>(CATEGORY_VERSION_COLUMNS);
		const skipped = new Set<string>(Object.keys(CATEGORY_VERSION_SKIPPED));
		for (const column of columns)
			expect(
				[versioned, skipped].filter((l) => l.has(column)).length,
				column,
			).toBe(1);
		for (const listed of [...versioned, ...skipped])
			expect(columns, listed).toContain(listed);
		for (const [column, reason] of Object.entries(CATEGORY_VERSION_SKIPPED))
			expect(reason.length, column).toBeGreaterThan(10);
	});

	it("the table has one trigger of the function: BEFORE UPDATE on each row, not UPDATE OF", async () => {
		const BEFORE_ROW_UPDATE = 1 | 2 | 16;
		const rows = await adminDb.$queryRaw<
			{ table: string; type: number; cols: number }[]
		>`
			SELECT c.relname AS "table", t.tgtype::int AS "type",
			       cardinality(t.tgattr::int2[])::int AS "cols"
			FROM pg_trigger t
			JOIN pg_class c ON c.oid = t.tgrelid
			JOIN pg_proc p ON p.oid = t.tgfoid
			WHERE p.proname = ${FN} AND NOT t.tgisinternal`;
		expect(rows).toEqual([
			{ table: "category", type: BEFORE_ROW_UPDATE, cols: 0 },
		]);
	});

	it("the function runs as its caller and the app role has no EXECUTE on it", async () => {
		const [fn] = await adminDb.$queryRaw<
			{ definer: boolean; app: boolean; pub: boolean }[]
		>`
			SELECT p.prosecdef AS definer,
			       has_function_privilege('retrospend_app', p.oid, 'EXECUTE') AS app,
			       (p.proacl IS NULL OR EXISTS (
			         SELECT 1 FROM aclexplode(p.proacl) a
			         WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')) AS pub
			FROM pg_proc p WHERE p.proname = ${FN}`;
		expect(fn).toEqual({ definer: false, app: false, pub: false });
	});
});

describe("what the trigger does to each column", () => {
	// fixtureDb gives a sealed name its index, as category.service does.
	const made = async (
		data: Partial<Prisma.CategoryUncheckedCreateInput> = {},
	) => {
		const { user } = await createTestUser();
		const row = await fixtureDb.category.create({
			data: { userId: user.id, name: "Probe", color: "teal", ...data },
		});
		return { id: row.id, userId: user.id, db: fixtureDb };
	};
	const versionOf = async (id: string) =>
		(await adminDb.category.findUniqueOrThrow({ where: { id } })).version;

	/** A different value for each column, so a column added to a list needs a probe here. */
	const CHANGES: Record<
		| CategoryVersionColumn
		| Exclude<CategoryVersionSkipped, "id" | "userId" | "version">,
		Prisma.CategoryUpdateInput
	> = {
		color: { color: "rose" },
		icon: { icon: "house" },
		excludeByDefault: { excludeByDefault: true },
		name: { name: "Renamed" },
		nameIndex: { nameIndex: "0123456789abcdef:ff" },
		kind: { kind: "INCOME" },
		isFixed: { isFixed: true },
	};

	it("every column of both lists has a probe", () => {
		const wanted = [
			...CATEGORY_VERSION_COLUMNS,
			...Object.keys(CATEGORY_VERSION_SKIPPED).filter(
				(c) => !["id", "userId", "version"].includes(c),
			),
		];
		expect(Object.keys(CHANGES).sort()).toEqual(wanted.sort());
	});

	for (const column of CATEGORY_VERSION_COLUMNS) {
		it(`a changed ${column} moves the version by 1, and the same value again does not`, async () => {
			const { id, db } = await made();
			await db.category.update({ where: { id }, data: CHANGES[column] });
			expect(await versionOf(id)).toBe(1);
			await db.category.update({ where: { id }, data: CHANGES[column] });
			expect(await versionOf(id)).toBe(1);
		});
	}

	for (const column of Object.keys(CHANGES).filter(
		(c) => !(CATEGORY_VERSION_COLUMNS as readonly string[]).includes(c),
	)) {
		it(`a changed ${column} leaves the version alone`, async () => {
			const { id, db } = await made();
			await db.category.update({
				where: { id },
				data: CHANGES[column as keyof typeof CHANGES],
			});
			expect(await versionOf(id)).toBe(0);
		});
	}

	it("a reseal-shaped write, the stored name and its index rewritten and no new text, leaves the version", async () => {
		const { id } = await made();
		const before = await adminDb.category.findUniqueOrThrow({ where: { id } });
		await adminDb.$executeRaw`
			UPDATE "category" SET "name" = 'Other bytes', "nameIndex" = 'aaaaaaaaaaaaaaaa:bb' WHERE "id" = ${id}`;
		// Put the stored bytes back: the sealed sweep allows no plaintext left behind.
		await adminDb.$executeRaw`
			UPDATE "category" SET "name" = ${before.name}::text, "nameIndex" = ${before.nameIndex}::text WHERE "id" = ${id}`;
		expect(await versionOf(id)).toBe(0);
	});

	it("a null icon that becomes a value, and a value that becomes null, are each a change", async () => {
		const { id, db } = await made();
		// A row comparison with <> would answer null here and miss both.
		await db.category.update({ where: { id }, data: { icon: "house" } });
		expect(await versionOf(id)).toBe(1);
		await db.category.update({ where: { id }, data: { icon: null } });
		expect(await versionOf(id)).toBe(2);
	});

	it("a null that stays null and values written back are not a change", async () => {
		const { id, db } = await made();
		await db.category.update({
			where: { id },
			data: { color: "teal", icon: null, excludeByDefault: false },
		});
		expect(await versionOf(id)).toBe(0);
	});

	it("a write that moves the version itself by 1 and changes a column is one bump, not two", async () => {
		const { id } = await made();
		await adminDb.$executeRaw`
			UPDATE "category" SET "version" = "version" + 1, "color" = 'rose' WHERE "id" = ${id}`;
		expect(await versionOf(id)).toBe(1);
	});

	it("a write that moves the version above OLD + 1 keeps its value, with or without a changed column", async () => {
		const { id } = await made();
		await adminDb.$executeRaw`
			UPDATE "category" SET "version" = 5, "color" = 'rose' WHERE "id" = ${id}`;
		expect(await versionOf(id)).toBe(5);
		await adminDb.$executeRaw`UPDATE "category" SET "version" = 9 WHERE "id" = ${id}`;
		expect(await versionOf(id)).toBe(9);
	});

	it("a write that lowers the version is refused, whatever else it changes, and nothing is written", async () => {
		const { id } = await made({ version: 5 });
		await expect(
			adminDb.$executeRaw`UPDATE "category" SET "version" = 4 WHERE "id" = ${id}`,
		).rejects.toThrow(/cannot go down/);
		await expect(
			adminDb.$executeRaw`
				UPDATE "category" SET "version" = 0, "color" = 'rose' WHERE "id" = ${id}`,
		).rejects.toThrow(/cannot go down/);
		await expect(
			adminDb.$executeRaw`UPDATE "category" SET "version" = -1 WHERE "id" = ${id}`,
		).rejects.toThrow(/cannot go down/);
		const row = await adminDb.category.findUniqueOrThrow({ where: { id } });
		expect({ version: row.version, color: row.color }).toEqual({
			version: 5,
			color: "teal",
		});
	});

	it("a write that keeps the version where it is, with nothing else changed, is allowed", async () => {
		const { id } = await made({ version: 5 });
		await adminDb.$executeRaw`UPDATE "category" SET "version" = 5 WHERE "id" = ${id}`;
		expect(await versionOf(id)).toBe(5);
	});

	it("an insert keeps the version it is given, and the next change is the one after", async () => {
		const { id, db } = await made({ version: 7 });
		expect(await versionOf(id)).toBe(7);
		await db.category.update({ where: { id }, data: { color: "rose" } });
		expect(await versionOf(id)).toBe(8);
	});

	it("a change made as retrospend_app, which has no EXECUTE on the function, still moves it", async () => {
		const { id, userId } = await made();
		const asApp = createUserScopedDb(userId);
		await asApp.category.update({ where: { id }, data: { icon: "house" } });
		expect(await versionOf(id)).toBe(1);
		await asApp.category.update({
			where: { id },
			data: { excludeByDefault: true },
		});
		expect(await versionOf(id)).toBe(2);
	});
});

describe("the rollback snippet", () => {
	const count = async (client: import("pg").Client, name = NAME) => {
		const one = async (sql: string) =>
			(await client.query(sql)).rows[0].n as number;
		return {
			trigger: await one(`
				SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
				WHERE p.proname = '${FN}' AND NOT t.tgisinternal`),
			functions: await one(`
				SELECT count(*)::int AS n FROM pg_proc
				WHERE pronamespace = 'public'::regnamespace AND proname = '${FN}'`),
			column: await one(`
				SELECT count(*)::int AS n FROM information_schema.columns
				WHERE table_schema = 'public' AND table_name = 'category' AND column_name = 'version'`),
			record: await one(`
				SELECT count(*)::int AS n FROM _prisma_migrations WHERE migration_name = '${name}'`),
		};
	};

	it("takes the trigger, the function and the column away, twice, and the migration brings them back, twice", async () => {
		const snippet = read(`prisma/rollback/${NAME}.sql`);
		const migration = read(`prisma/migrations/${NAME}/migration.sql`);
		await inRolledBackTransaction(async (client) => {
			expect(await count(client)).toEqual({
				trigger: 1,
				functions: 1,
				column: 1,
				record: 1,
			});
			await client.query(snippet);
			await client.query(snippet);
			// Without the record the next start applies the migration again.
			expect(await count(client)).toEqual({
				trigger: 0,
				functions: 0,
				column: 0,
				record: 0,
			});
			await client.query(migration);
			await client.query(migration);
			expect(await count(client)).toEqual({
				trigger: 1,
				functions: 1,
				column: 1,
				record: 0,
			});
			// The migrated-forward trigger works: a changed color is a new version.
			const { user } = await createTestUser();
			const id = (
				await client.query(
					`INSERT INTO "category" ("id", "name", "color", "userId") VALUES ('c-fwd', 'Fwd', 'teal', $1) RETURNING "id"`,
					[user.id],
				)
			).rows[0].id;
			await client.query(
				`UPDATE "category" SET "color" = 'rose' WHERE "id" = $1`,
				[id],
			);
			expect(
				(
					await client.query(
						`SELECT "version" FROM "category" WHERE "id" = $1`,
						[id],
					)
				).rows[0].version,
			).toBe(1);
		});
	}, 120_000);

	it("keeps the rows of the table and the other version triggers' objects", async () => {
		const snippet = read(`prisma/rollback/${NAME}.sql`);
		const { user } = await createTestUser();
		const row = await fixtureDb.category.create({
			data: { userId: user.id, name: "Kept", color: "teal" },
		});
		await inRolledBackTransaction(async (client) => {
			await client.query(snippet);
			const rows = (
				await client.query(
					`SELECT "color"::text AS c FROM "category" WHERE "id" = $1`,
					[row.id],
				)
			).rows;
			expect(rows).toEqual([{ c: "teal" }]);
			for (const [proc, migration] of [
				["stamp_moves", STAMPS],
				["asset_account_version_moves", ACCOUNTS],
			] as const) {
				expect(
					(
						await client.query(
							`SELECT count(*)::int AS n FROM pg_proc WHERE proname = '${proc}'`,
						)
					).rows[0].n,
					proc,
				).toBe(1);
				expect(
					(
						await client.query(
							`SELECT count(*)::int AS n FROM _prisma_migrations WHERE migration_name = '${migration}'`,
						)
					).rows[0].n,
					migration,
				).toBe(1);
			}
		});
	}, 120_000);

	it("the stamp trigger's and the account version's rollbacks leave this migration's objects alone", async () => {
		await inRolledBackTransaction(async (client) => {
			for (const name of [STAMPS, ACCOUNTS]) {
				const snippet = read(`prisma/rollback/${name}.sql`);
				await client.query(snippet);
				await client.query(snippet);
			}
			expect(await count(client)).toEqual({
				trigger: 1,
				functions: 1,
				column: 1,
				record: 1,
			});
		});
	}, 120_000);

	it("an update with the trigger gone stores no version, as the older image never wrote one", async () => {
		const snippet = read(`prisma/rollback/${NAME}.sql`);
		const { user } = await createTestUser();
		const row = await fixtureDb.category.create({
			data: { userId: user.id, name: "Older", color: "teal" },
		});
		await inRolledBackTransaction(async (client) => {
			await client.query(snippet);
			await client.query(
				`UPDATE "category" SET "excludeByDefault" = true WHERE "id" = $1`,
				[row.id],
			);
			const cols = (
				await client.query(`SELECT * FROM "category" WHERE "id" = $1`, [row.id])
			).rows[0];
			expect("version" in cols).toBe(false);
			expect(cols.excludeByDefault).toBe(true);
		});
	}, 120_000);
});
