/**
 * stamp_moves: an "updatedAt" stamp always moves forward when a row is updated
 * (migration 20261126100000_stamps_always_move). The catalog test builds its
 * list from the schema and the trigger catalog, never from the migration's own
 * list (AGENTS 6.8); the behavior tests run the trigger as the owner, as the
 * app's role, inside a definer function, and through the rollback snippet.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { arsUser, expense } from "~/server/services/category/__tests__/merge-kit";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { readSchema } from "~/test/prisma-schema";
import { inRolledBackTransaction } from "~/test/rolled-back-sql";
import { REPO_ROOT } from "~/test/uiRules/paths";

const read = (path: string) => readFileSync(join(REPO_ROOT, path), "utf8");
const NAME = "20261126100000_stamps_always_move";

/**
 * The @updatedAt tables that keep the stamp the writer gives them, and why
 * that is safe under the rule "a stamp always moves". Keyed by table.
 */
const KEPT: Record<string, string> = {
	asset_account:
		"the icon swap (accounts/icon.ts:63) and the snapshot restore (accounts/delete-snapshot.ts:266) keep the stamp on purpose; the only server reader (api-v1/guard.ts:66-86 stampOfAccount) hashes it together with balance, closedAt, rate type and row counts, and no client-held version compares it",
	exchange_rate:
		"written by the sidecar with NOW() and backdated by the rate tests; read only as freshness (the newest stamp, rates_moved), never as a lost-write guard",
};

const stamped = readSchema()
	.filter((m) => m.fields.some((f) => /@updatedAt/.test(f.attributes)))
	.map((m) => m.table);

type TriggerRow = {
	table: string;
	name: string;
	type: number;
	columns: string[];
};

const triggers = () =>
	adminDb.$queryRaw<TriggerRow[]>`
		SELECT c.relname AS "table", t.tgname AS "name", t.tgtype::int AS "type",
		       ARRAY(
		         SELECT a.attname::text FROM pg_attribute a
		         WHERE a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr)
		         ORDER BY a.attname
		       ) AS "columns"
		FROM pg_trigger t
		JOIN pg_class c ON c.oid = t.tgrelid
		JOIN pg_proc p ON p.oid = t.tgfoid
		WHERE p.proname = 'stamp_moves' AND NOT t.tgisinternal
		ORDER BY c.relname`;

afterEach(() => vi.useRealTimers());

describe("which tables carry the trigger", () => {
	it("every @updatedAt model of the schema has one, except the kept tables, and no other table does", async () => {
		const expected = stamped.filter((t) => !(t in KEPT)).sort();
		expect(expected.length).toBeGreaterThan(25);
		expect((await triggers()).map((t) => t.table)).toEqual(expected);
	});

	it("each kept table is an @updatedAt model, so a renamed or dropped model leaves no stale entry", () => {
		for (const table of Object.keys(KEPT)) expect(stamped).toContain(table);
	});

	it("each trigger is BEFORE UPDATE OF updatedAt, once per row, and only that", async () => {
		const BEFORE_ROW_UPDATE = 1 | 2 | 16;
		for (const t of await triggers()) {
			expect(t.type, t.table).toBe(BEFORE_ROW_UPDATE);
			expect(t.columns, t.table).toEqual(["updatedAt"]);
			expect(t.name).toBe(`${t.table}_stamp_moves`);
		}
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
			FROM pg_proc p WHERE p.proname = 'stamp_moves'`;
		expect(fn).toEqual({ definer: false, app: false, pub: false });
	});
});

describe("what the trigger stores", () => {
	const T = new Date("2026-03-01T10:00:00.000Z");
	const plus = (d: Date, ms: number) => new Date(d.getTime() + ms);

	async function row() {
		const me = await arsUser();
		return { me, ...(await expense(me, null, 10, { updatedAt: T })) };
	}
	const stampOf = async (id: string) =>
		(
			await adminDb.expense.findUniqueOrThrow({
				where: { id },
				select: { updatedAt: true },
			})
		).updatedAt;

	it("the same stamp again stores one millisecond later, every time", async () => {
		const { id } = await row();
		for (const step of [1, 2, 3]) {
			await adminDb.expense.update({
				where: { id },
				data: { excludeFromAnalytics: step % 2 === 1, updatedAt: T },
			});
			expect((await stampOf(id)).getTime()).toBe(T.getTime() + step);
		}
	});

	it("an older stamp is never stored: the stamp goes forward by a millisecond", async () => {
		const { id } = await row();
		await adminDb.expense.update({
			where: { id },
			data: { excludeFromAnalytics: true, updatedAt: plus(T, -86_400_000) },
		});
		expect((await stampOf(id)).getTime()).toBe(T.getTime() + 1);
	});

	it("a later stamp stands as given", async () => {
		const { id } = await row();
		await adminDb.expense.update({
			where: { id },
			data: { excludeFromAnalytics: true, updatedAt: plus(T, 5_000) },
		});
		expect((await stampOf(id)).getTime()).toBe(T.getTime() + 5_000);
	});

	it("an update with the app clock behind the stored stamp moves it forward by a millisecond", async () => {
		const { id } = await row();
		vi.useFakeTimers({ toFake: ["Date"], now: plus(T, -3_600_000) });
		// No stamp given: the client sets its own (behind) clock.
		await adminDb.expense.update({
			where: { id },
			data: { excludeFromAnalytics: true },
		});
		expect((await stampOf(id)).getTime()).toBe(T.getTime() + 1);
	});

	it("an update that leaves the stamp out keeps it", async () => {
		const { id } = await row();
		await adminDb.$executeRaw`UPDATE "expense" SET "excludeFromAnalytics" = true WHERE "id" = ${id}`;
		expect((await stampOf(id)).getTime()).toBe(T.getTime());
	});

	it("an update made as retrospend_app, which has no EXECUTE on the function, still advances the stamp", async () => {
		const { user, db } = await createTestUser();
		const made = await expense(user.id, null, 10, { updatedAt: T });
		await db.expense.update({
			where: { id: made.id },
			data: { excludeFromAnalytics: true, updatedAt: T },
		});
		expect((await stampOf(made.id)).getTime()).toBe(T.getTime() + 1);
	});

	it("a definer function that sets the stamp to CURRENT_TIMESTAMP (release_payment_locks) moves it past the stamp it replaces", async () => {
		await inRolledBackTransaction(async (client) => {
			const id = "stamps-lock-probe";
			await client.query(
				`INSERT INTO "payment" ("id", "payerType", "payerId", "payeeType", "payeeId",
				   "amount", "currency", "paidOn", "recordedByType", "recordedById", "status", "updatedAt")
				 VALUES ($1, 'user', 'p1', 'user', 'p2', 1, 'USD', CURRENT_DATE, 'user', 'p1', 'FINALIZED', CURRENT_TIMESTAMP)`,
				[id],
			);
			// Stamped at this transaction's CURRENT_TIMESTAMP, the very value the
			// function writes next: without the trigger the stamp would not move.
			await client.query(
				`INSERT INTO "shared_transaction" ("id", "description", "amount", "currency", "date",
				   "paidByType", "paidById", "createdByType", "createdById",
				   "isLocked", "lockedByPaymentId", "updatedAt")
				 VALUES ($1, 'x', 1, 'USD', CURRENT_TIMESTAMP, 'user', 'p1', 'user', 'p1', true, $1, CURRENT_TIMESTAMP)`,
				[id],
			);
			const before = (
				await client.query(
					`SELECT "updatedAt" FROM "shared_transaction" WHERE "id" = $1`,
					[id],
				)
			).rows[0].updatedAt as Date;
			await client.query(
				`UPDATE "payment" SET "status" = 'PROPOSED' WHERE "id" = $1`,
				[id],
			);
			const after = (
				await client.query(
					`SELECT "updatedAt", "isLocked" FROM "shared_transaction" WHERE "id" = $1`,
					[id],
				)
			).rows[0] as { updatedAt: Date; isLocked: boolean };
			expect(after.isLocked).toBe(false);
			expect(after.updatedAt.getTime()).toBe(before.getTime() + 1);
		});
	});
});

describe("the rollback snippet", () => {
	const count = async (client: import("pg").Client) => {
		const one = async (sql: string) =>
			(await client.query(sql)).rows[0].n as number;
		return {
			triggers: await one(`
				SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
				WHERE p.proname = 'stamp_moves' AND NOT t.tgisinternal`),
			functions: await one(`
				SELECT count(*)::int AS n FROM pg_proc
				WHERE pronamespace = 'public'::regnamespace AND proname = 'stamp_moves'`),
			record: await one(`
				SELECT count(*)::int AS n FROM _prisma_migrations
				WHERE migration_name = '${NAME}'`),
		};
	};

	it("takes every object away, twice, and the migration brings every one back, twice", async () => {
		const snippet = read(`prisma/rollback/${NAME}.sql`);
		const migration = read(`prisma/migrations/${NAME}/migration.sql`);
		const whole = {
			triggers: stamped.filter((t) => !(t in KEPT)).length,
			functions: 1,
			record: 1,
		};
		await inRolledBackTransaction(async (client) => {
			expect(await count(client)).toEqual(whole);
			await client.query(snippet);
			await client.query(snippet);
			// Without the record the next start applies the migration again.
			expect(await count(client)).toEqual({
				triggers: 0,
				functions: 0,
				record: 0,
			});
			await client.query(migration);
			await client.query(migration);
			expect(await count(client)).toEqual({ ...whole, record: 0 });
		});
	}, 120_000);

	it("an update with the trigger gone stores the stamp it is given, as the older image does", async () => {
		const snippet = read(`prisma/rollback/${NAME}.sql`);
		const { user } = await createTestUser();
		const made = await expense(user.id, null, 10, {
			updatedAt: new Date("2026-03-01T10:00:00.000Z"),
		});
		await inRolledBackTransaction(async (client) => {
			await client.query(snippet);
			const given = new Date("2026-03-01T10:00:00.000Z");
			await client.query(
				`UPDATE "expense" SET "updatedAt" = $2 WHERE "id" = $1`,
				[made.id, given],
			);
			const stored = (
				await client.query(`SELECT "updatedAt" FROM "expense" WHERE "id" = $1`, [
					made.id,
				])
			).rows[0].updatedAt as Date;
			expect(stored.getTime()).toBe(given.getTime());
		});
	}, 120_000);
});
