/**
 * asset_account.version (migration 20261127100000_account_version). The
 * catalog tests build their lists from the schema and the trigger function in
 * the database, never from the migration's own text (AGENTS 6.8): the function
 * must name exactly ACCOUNT_VERSION_COLUMNS, and every scalar column of
 * AssetAccount sits in exactly one of that list and ACCOUNT_VERSION_SKIPPED.
 * The behavior tests change each column in turn and then run the real writers
 * (a balance update, a transfer, an income leg, a counted move, an icon swap,
 * a rename, edit, close, reopen, a restore), as the owner and as the app role.
 * The rollback tests run the snippet twice and migrate forward again.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
	ACCOUNT_VERSION_COLUMNS,
	ACCOUNT_VERSION_SKIPPED,
	ACCOUNT_VERSION_WHEN_RATE_TYPE,
	type AccountVersionColumn,
	type AccountVersionConditional,
	type AccountVersionSkipped,
} from "@retrospend/domain/accounts/version-columns";
import { CUSTOM_RATE_TYPE } from "@retrospend/domain/rate-booking";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { userTransaction } from "~/server/db-tx";
import {
	restoreAccount,
	snapshotAccount,
} from "~/server/services/accounts/delete-snapshot";
import { setAccountIcon } from "~/server/services/accounts/icon";
import {
	closeAccount,
	deleteAccountIn,
	editAccount,
	reopenAccount,
} from "~/server/services/accounts/manage";
import { setRateType } from "~/server/services/accounts/rate-type.mutation";
import {
	arsUser,
	openAccount,
	seedArsRates,
} from "~/server/services/accounts/test-fixtures";
import { updateBalance } from "~/server/services/accounts/update-balance.mutation";
import { addIncome } from "~/server/services/income/add.mutation";
import { forUser } from "~/server/services/preview";
import { createTransfer } from "~/server/services/transfers/create.mutation";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { readSchema } from "~/test/prisma-schema";
import { inRolledBackTransaction } from "~/test/rolled-back-sql";
import { REPO_ROOT } from "~/test/uiRules/paths";
import type { Prisma } from "~prisma";

const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");
const NAME = "20261127100000_account_version";
const STAMPS = "20261126100000_stamps_always_move";
const FN = "asset_account_version_moves";

afterEach(() => vi.useRealTimers());

const model = readSchema().find((m) => m.name === "AssetAccount");
const modelNames = new Set(readSchema().map((m) => m.name));
/** The scalar columns of AssetAccount: no list, no relation. */
const columns = (model?.fields ?? [])
	.filter((f) => !f.list && !modelNames.has(f.type))
	.map((f) => f.name);

describe("which columns move the version", () => {
	it("the function names exactly ACCOUNT_VERSION_COLUMNS and the conditional column, on the old and the new side", async () => {
		const [fn] = await adminDb.$queryRaw<{ src: string }[]>`
			SELECT prosrc AS src FROM pg_proc
			WHERE proname = ${FN} AND pronamespace = 'public'::regnamespace`;
		const named = (side: "OLD" | "NEW") =>
			[
				...new Set(
					[...(fn?.src ?? "").matchAll(new RegExp(`${side}\\."(\\w+)"`, "g"))]
						.map((m) => m[1] as string)
						.filter((c) => c !== "version"),
				),
			].sort();
		const expected = [
			...ACCOUNT_VERSION_COLUMNS,
			...Object.keys(ACCOUNT_VERSION_WHEN_RATE_TYPE),
		].sort();
		expect(named("OLD")).toEqual(expected);
		expect(named("NEW")).toEqual(expected);
	});

	it("the conditional column bumps only for the custom rate type, whose name is the domain's", async () => {
		const [fn] = await adminDb.$queryRaw<{ src: string }[]>`
			SELECT prosrc AS src FROM pg_proc
			WHERE proname = ${FN} AND pronamespace = 'public'::regnamespace`;
		const src = fn?.src ?? "";
		for (const [column, rateType] of Object.entries(
			ACCOUNT_VERSION_WHEN_RATE_TYPE,
		)) {
			const found = src.match(
				new RegExp(
					`NEW\\."exchangeRateType"\\s*=\\s*'([^']*)'\\s+AND\\s+NEW\\."${column}"\\s+IS DISTINCT FROM\\s+OLD\\."${column}"`,
				),
			);
			expect(found?.[1], column).toBe(rateType);
		}
		expect(ACCOUNT_VERSION_WHEN_RATE_TYPE.exchangeRate).toBe(CUSTOM_RATE_TYPE);
	});

	it("every scalar column of the schema is in exactly one of the three lists, and no list names a column that is gone", () => {
		expect(columns.length).toBeGreaterThan(15);
		const versioned = new Set<string>(ACCOUNT_VERSION_COLUMNS);
		const conditional = new Set<string>(
			Object.keys(ACCOUNT_VERSION_WHEN_RATE_TYPE),
		);
		const skipped = new Set<string>(Object.keys(ACCOUNT_VERSION_SKIPPED));
		for (const column of columns) {
			expect(
				[versioned, conditional, skipped].filter((l) => l.has(column)).length,
				column,
			).toBe(1);
		}
		for (const listed of [...versioned, ...conditional, ...skipped])
			expect(columns, listed).toContain(listed);
		for (const [column, reason] of Object.entries(ACCOUNT_VERSION_SKIPPED))
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
			{ table: "asset_account", type: BEFORE_ROW_UPDATE, cols: 0 },
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
	const idFor = async () => {
		const { user, db } = await createTestUser();
		// The user-scoped client seals the name, as the sealed suite needs.
		const made = await db.assetAccount.create({
			data: {
				userId: user.id,
				name: "Probe",
				type: "CASH",
				currency: "ARS",
				balance: "100",
				isLiquid: false,
			},
		});
		return { id: made.id, db };
	};
	const versionOf = async (id: string) =>
		(await adminDb.assetAccount.findUniqueOrThrow({ where: { id } })).version;

	/** A different value for each column, so a column added to a list needs a probe here. */
	const CHANGES: Record<
		| AccountVersionColumn
		| AccountVersionConditional
		| Exclude<
				AccountVersionSkipped,
				"id" | "userId" | "createdAt" | "version" | "updatedAt"
		  >,
		Prisma.AssetAccountUpdateInput
	> = {
		type: { type: "INVESTMENT" },
		currency: { currency: "USD" },
		exchangeRateType: { exchangeRateType: "blue" },
		closedAt: { closedAt: new Date("2026-03-10T00:00:00Z") },
		inBudget: { inBudget: true },
		isLiquid: { isLiquid: true },
		interestRate: { interestRate: "1.5" },
		minimumPayment: { minimumPayment: "10" },
		dueDate: { dueDate: 5 },
		balance: { balance: "200" },
		countedUnits: { countedUnits: "5" },
		exchangeRate: { exchangeRate: "1545" },
		iconKind: { iconKind: "MONOGRAM" },
		iconValue: { iconValue: "avatar-1" },
		name: { name: "Renamed" },
	};

	it("every column of both lists has a probe", () => {
		const probed = new Set(Object.keys(CHANGES));
		const wanted = [
			...ACCOUNT_VERSION_COLUMNS,
			...Object.keys(ACCOUNT_VERSION_WHEN_RATE_TYPE),
			...Object.keys(ACCOUNT_VERSION_SKIPPED).filter(
				(c) =>
					!["id", "userId", "createdAt", "version", "updatedAt"].includes(c),
			),
		];
		expect([...probed].sort()).toEqual(wanted.sort());
	});

	for (const column of ACCOUNT_VERSION_COLUMNS) {
		it(`a changed ${column} moves the version by 1, and the same value again does not`, async () => {
			const { id, db } = await idFor();
			await db.assetAccount.update({
				where: { id },
				data: CHANGES[column],
			});
			expect(await versionOf(id)).toBe(1);
			await db.assetAccount.update({
				where: { id },
				data: CHANGES[column],
			});
			expect(await versionOf(id)).toBe(1);
		});
	}

	for (const column of Object.keys(CHANGES).filter(
		(c) => !(ACCOUNT_VERSION_COLUMNS as readonly string[]).includes(c),
	)) {
		it(`a changed ${column} leaves the version alone`, async () => {
			const { id, db } = await idFor();
			await db.assetAccount.update({
				where: { id },
				data: CHANGES[column as keyof typeof CHANGES],
			});
			expect(await versionOf(id)).toBe(0);
		});
	}

	it("a changed exchangeRate moves the version only while the rate type is custom", async () => {
		const { user, db } = await createTestUser();
		const make = (exchangeRateType: string | null, name: string) =>
			db.assetAccount.create({
				data: {
					userId: user.id,
					name,
					type: "CASH",
					currency: "USD",
					balance: "100",
					exchangeRateType,
					exchangeRate: "1000",
				},
			});
		const custom = await make(CUSTOM_RATE_TYPE, "Custom");
		const blue = await make("blue", "Blue");
		for (const id of [custom.id, blue.id])
			await db.assetAccount.update({
				where: { id },
				data: { exchangeRate: "1500" },
			});
		expect(await versionOf(custom.id)).toBe(1);
		expect(await versionOf(blue.id)).toBe(0);
		// The same rate again, spelled differently, is not a change.
		await db.assetAccount.update({
			where: { id: custom.id },
			data: { exchangeRate: "1500.000000" },
		});
		expect(await versionOf(custom.id)).toBe(1);
		// Both at once: the new type decides, and it is one bump.
		await db.assetAccount.update({
			where: { id: blue.id },
			data: { exchangeRateType: CUSTOM_RATE_TYPE, exchangeRate: "1600" },
		});
		expect(await versionOf(blue.id)).toBe(1);
	});

	it("a null that stays null and a value written back are not a change", async () => {
		const { id, db } = await idFor();
		await db.assetAccount.update({
			where: { id },
			data: {
				type: "CASH",
				currency: "ARS",
				exchangeRateType: null,
				closedAt: null,
				inBudget: null,
				isLiquid: false,
				interestRate: null,
				minimumPayment: null,
				dueDate: null,
			},
		});
		expect(await versionOf(id)).toBe(0);
	});

	it("an insert keeps the version it is given", async () => {
		const { user, db } = await createTestUser();
		const made = await db.assetAccount.create({
			data: {
				userId: user.id,
				name: "Given",
				type: "CASH",
				currency: "ARS",
				balance: "1",
				version: 7,
			},
		});
		expect(made.version).toBe(7);
		await db.assetAccount.update({
			where: { id: made.id },
			data: { isLiquid: true },
		});
		expect(await versionOf(made.id)).toBe(8);
	});

	it("a change made as retrospend_app, which has no EXECUTE on the function, still moves it", async () => {
		const { user, db } = await createTestUser();
		const made = await db.assetAccount.create({
			data: {
				userId: user.id,
				name: "Mine",
				type: "CASH",
				currency: "ARS",
				balance: "1",
			},
		});
		await db.assetAccount.update({
			where: { id: made.id },
			data: { isLiquid: true },
		});
		expect(await versionOf(made.id)).toBe(1);
		await db.assetAccount.update({
			where: { id: made.id },
			data: { balance: "2", name: "Mine again" },
		});
		expect(await versionOf(made.id)).toBe(1);
	});
});

describe("what the real writers do to the version", () => {
	beforeAll(seedArsRates);

	async function world() {
		const { user, db } = await arsUser();
		const userId = user.id;
		return {
			db,
			userId,
			ars: await openAccount(userId, "Savings", "CASH", "ARS", 1_000_000),
			usdA: await openAccount(userId, "USD A", "INVESTMENT", "USD", 100, {
				exchangeRateType: "blue",
			}),
			usdB: await openAccount(userId, "USD B", "CASH", "USD", 0, {
				exchangeRateType: "blue",
			}),
		};
	}
	const versionOf = async (id: string) =>
		(await adminDb.assetAccount.findUniqueOrThrow({ where: { id } })).version;
	const fields = {
		name: "USD A",
		type: "INVESTMENT",
		currency: "USD",
		balance: 100,
		exchangeRateType: "blue",
		isLiquid: false,
	} as const;

	it("a new account starts at 0", async () => {
		const w = await world();
		expect(await versionOf(w.usdA)).toBe(0);
	});

	it("a balance update that keeps the rate type leaves the version; one that changes it moves it", async () => {
		const w = await world();
		const run = forUser(w.userId);
		await run.apply(updateBalance, { accountId: w.usdA, balance: "120" });
		expect(await versionOf(w.usdA)).toBe(0);
		await run.apply(updateBalance, {
			accountId: w.usdA,
			balance: "130",
			rateType: "official",
		});
		expect(await versionOf(w.usdA)).toBe(1);
	});

	it("a rate type change moves the version by 1", async () => {
		const w = await world();
		await forUser(w.userId).apply(setRateType, {
			accountId: w.usdA,
			rateType: "official",
		});
		expect(await versionOf(w.usdA)).toBe(1);
	});

	it("a transfer leg, an income leg and a counted move leave the version on every account they touch", async () => {
		const w = await world();
		const run = forUser(w.userId);
		await run.apply(addIncome, {
			title: "Salary",
			amount: "1000",
			currency: "ARS",
			into: w.ars,
		});
		await run.apply(createTransfer, {
			fromAccountId: w.ars,
			toAccountId: w.usdA,
			fromAmount: "1468",
		});
		await adminDb.assetAccount.update({
			where: { id: w.usdA },
			data: { countedUnits: "60" },
		});
		await run.apply(createTransfer, {
			fromAccountId: w.usdA,
			toAccountId: w.usdB,
			fromAmount: "40",
		});
		for (const id of [w.ars, w.usdA, w.usdB])
			expect(await versionOf(id), id).toBe(0);
		expect(
			(
				await adminDb.assetAccount.findUniqueOrThrow({ where: { id: w.usdB } })
			).balance.toString(),
		).toBe("40");
	});

	it("an icon swap and a rename leave the version", async () => {
		const w = await world();
		await setAccountIcon(adminDb, w.userId, w.ars, {
			kind: "MONOGRAM",
			value: "avatar-3",
		});
		await w.db.assetAccount.update({
			where: { id: w.ars },
			data: { name: "Renamed" },
		});
		expect(await versionOf(w.ars)).toBe(0);
	});

	it("edit, close and reopen each move it once", async () => {
		const w = await world();
		await editAccount(adminDb, w.userId, w.usdA, { ...fields, isLiquid: true });
		expect(await versionOf(w.usdA)).toBe(1);
		await closeAccount(adminDb, w.userId, w.usdA);
		expect(await versionOf(w.usdA)).toBe(2);
		await reopenAccount(adminDb, w.userId, w.usdA);
		expect(await versionOf(w.usdA)).toBe(3);
		// Closing a closed account or an edit that changes nothing is no new version.
		await editAccount(adminDb, w.userId, w.usdA, { ...fields, isLiquid: true });
		expect(await versionOf(w.usdA)).toBe(3);
	});

	describe("a restore", () => {
		const stashAndDelete = (userId: string, id: string) =>
			userTransaction(adminDb, userId, async (tx) => {
				const snapshot = await snapshotAccount(tx, userId, id);
				await deleteAccountIn(tx, userId, id);
				return snapshot;
			});

		it("keeps the version the stash holds", async () => {
			const w = await world();
			await editAccount(adminDb, w.userId, w.usdA, {
				...fields,
				isLiquid: true,
			});
			await closeAccount(adminDb, w.userId, w.usdA);
			expect(await versionOf(w.usdA)).toBe(2);
			const snapshot = await stashAndDelete(w.userId, w.usdA);
			// The row left through JSON, as the stash is stored.
			const stored = JSON.parse(JSON.stringify(snapshot));
			await userTransaction(adminDb, w.userId, (tx) =>
				restoreAccount(tx, w.userId, stored),
			);
			expect(await versionOf(w.usdA)).toBe(2);
		});

		it("bumps a stash written before the column existed, so an edit queued against the old account parks", async () => {
			const w = await world();
			const snapshot = await stashAndDelete(w.userId, w.usdA);
			const { version: _gone, ...old } = JSON.parse(
				JSON.stringify(snapshot.account),
			) as Record<string, unknown>;
			await userTransaction(adminDb, w.userId, (tx) =>
				restoreAccount(tx, w.userId, {
					...JSON.parse(JSON.stringify(snapshot)),
					account: old,
				}),
			);
			expect(await versionOf(w.usdA)).toBe(1);
		});
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
				WHERE table_schema = 'public' AND table_name = 'asset_account' AND column_name = 'version'`),
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
		});
	}, 120_000);

	it("keeps the rows of the table and the stamp trigger's objects", async () => {
		const snippet = read(`prisma/rollback/${NAME}.sql`);
		const { user, db } = await createTestUser();
		const made = await db.assetAccount.create({
			data: {
				userId: user.id,
				name: "Kept",
				type: "CASH",
				currency: "ARS",
				balance: "5",
			},
		});
		await inRolledBackTransaction(async (client) => {
			await client.query(snippet);
			const rows = (
				await client.query(
					`SELECT "balance"::text AS b FROM "asset_account" WHERE "id" = $1`,
					[made.id],
				)
			).rows;
			expect(rows).toEqual([{ b: "5.00000000" }]);
			const stamps = (
				await client.query(
					`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'stamp_moves'`,
				)
			).rows[0].n;
			expect(stamps).toBe(1);
			const record = (
				await client.query(
					`SELECT count(*)::int AS n FROM _prisma_migrations WHERE migration_name = '${STAMPS}'`,
				)
			).rows[0].n;
			expect(record).toBe(1);
		});
	}, 120_000);

	it("the stamp trigger's rollback leaves this migration's objects alone", async () => {
		const stampsSnippet = read(`prisma/rollback/${STAMPS}.sql`);
		await inRolledBackTransaction(async (client) => {
			await client.query(stampsSnippet);
			await client.query(stampsSnippet);
			expect(await count(client)).toEqual({
				trigger: 1,
				functions: 1,
				column: 1,
				record: 1,
			});
			const gone = (
				await client.query(
					`SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'stamp_moves'`,
				)
			).rows[0].n;
			expect(gone).toBe(0);
		});
	}, 120_000);

	it("an update with the trigger gone stores no version, as the older image never wrote one", async () => {
		const snippet = read(`prisma/rollback/${NAME}.sql`);
		const { user, db } = await createTestUser();
		const made = await db.assetAccount.create({
			data: {
				userId: user.id,
				name: "Older",
				type: "CASH",
				currency: "ARS",
				balance: "5",
			},
		});
		await inRolledBackTransaction(async (client) => {
			await client.query(snippet);
			await client.query(
				`UPDATE "asset_account" SET "isLiquid" = true WHERE "id" = $1`,
				[made.id],
			);
			const cols = (
				await client.query(`SELECT * FROM "asset_account" WHERE "id" = $1`, [
					made.id,
				])
			).rows[0];
			expect("version" in cols).toBe(false);
			expect(cols.isLiquid).toBe(true);
		});
	}, 120_000);
});
