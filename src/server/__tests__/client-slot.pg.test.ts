/**
 * The extension slot (E2EE D11 prep): the global client and the user-scoped
 * client are both built on one raw base through a slot, and interactive
 * transactions run on the extended client, so a query extension sees the model
 * calls inside them. The slot is empty today; this test fills it with a
 * counting extension on a client of its own (`buildClients` takes any base and
 * slot) and checks, on a real Postgres:
 *
 *   userTransaction on the global client         -> its model calls pass the slot
 *   scoped $transaction(callback)                -> its model calls pass the slot
 *   one scoped model call                        -> passes the slot once, outside the RLS batch
 *   a slot that calls `query` twice              -> two batches, each with its own set_config
 *   keystore facade                              -> never passes the slot
 *   RLS and the refusals of the scoped client    -> unchanged with a slot in place
 */
import { randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Keyring } from "~/server/crypto/field-crypto";
import { type ClientSlot, buildClients } from "~/server/db";
import { userTransaction } from "~/server/db-tx";
import { getOrCreateDataKeyring } from "~/server/services/keys/data-key.service";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { PrismaClient } from "~prisma";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
// The app's base takes a different log option, which only changes the type.
// This one reports each statement, so a test can count the RLS settings.
const base = new PrismaClient({
	adapter: new PrismaPg(pool),
	log: [{ emit: "event", level: "query" }],
}) as unknown as Parameters<typeof buildClients>[0];
const statements: string[] = [];
(
	base as unknown as {
		$on: (event: "query", run: (e: { query: string }) => void) => void;
	}
).$on("query", (e) => statements.push(e.query));
afterAll(async () => {
	await base.$disconnect();
	await pool.end();
});

const seen: string[] = [];
const countingSlot: ClientSlot = (client) =>
	client.$extends({
		name: "counting-slot",
		query: {
			$allModels: {
				$allOperations({ model, operation, args, query }) {
					seen.push(`${model}.${operation}`);
					return query(args);
				},
			},
		},
	}) as unknown as typeof client;

const clients = buildClients(base, countingSlot);
beforeEach(() => {
	seen.length = 0;
	statements.length = 0;
});

const category = (userId: string, name: string) =>
	adminDb.category.create({ data: { userId, name, color: "blue" } });

describe("the extension slot", () => {
	it("sees the model calls of userTransaction on the global client", async () => {
		const me = await createTestUser();
		await category(me.user.id, "Mine");
		seen.length = 0;

		const names = await userTransaction(clients.db, me.user.id, async (tx) => {
			const own = await tx.category.findMany({ where: { userId: me.user.id } });
			await tx.category.count({ where: { userId: me.user.id } });
			return own.map((c) => c.name);
		});

		expect(names).toEqual(["Mine"]);
		expect(seen).toEqual(["Category.findMany", "Category.count"]);
	});

	it("sees the model calls of a scoped client's interactive transaction", async () => {
		const me = await createTestUser();
		const scoped = clients.createUserScopedDb(me.user.id);

		await scoped.$transaction(async (tx) => {
			await tx.category.create({
				data: { userId: me.user.id, name: "Made", color: "blue" },
			});
			await tx.category.findFirst({ where: { userId: me.user.id } });
		});

		expect(seen).toEqual(["Category.create", "Category.findFirst"]);
		expect(
			await adminDb.category.count({ where: { userId: me.user.id } }),
		).toBe(1);
	});

	it("sits outside the RLS batch: a slot that runs `query` twice gets a batch each time", async () => {
		const me = await createTestUser();
		await category(me.user.id, "Mine");
		// The shape D11 needs: fieldCrypto reloads a key and retries once, and
		// every attempt must still run as this user. That only holds when the
		// slot wraps the batch. Inside the batch, `query` runs once per batch
		// and a second call would not carry the RLS settings.
		const retrying: ClientSlot = (client) =>
			client.$extends({
				name: "retrying-slot",
				query: {
					$allModels: {
						async $allOperations({ args, query }) {
							await query(args);
							return query(args);
						},
					},
				},
			}) as unknown as typeof client;
		const scoped = buildClients(base, retrying).createUserScopedDb(me.user.id);
		statements.length = 0;

		const rows = await scoped.category.findMany({});

		expect(rows.map((r) => r.name)).toEqual(["Mine"]);
		const rls = statements.filter((q) => q.includes("set_config"));
		expect(rls).toHaveLength(2);
		const selects = statements.filter((q) =>
			q.includes('FROM "public"."category"'),
		);
		expect(selects).toHaveLength(2);
		// Each select ran after its own set_config (BEGIN, set_config, select, COMMIT).
		const order = statements.filter(
			(q) => q.includes("set_config") || q.includes('FROM "public"."category"'),
		);
		expect(
			order.map((q) => (q.includes("set_config") ? "rls" : "select")),
		).toEqual(["rls", "select", "rls", "select"]);
	});

	it("runs one scoped model call through the slot once, outside the RLS batch", async () => {
		const [a, b] = await Promise.all([createTestUser(), createTestUser()]);
		await category(a.user.id, "A's");
		await category(b.user.id, "B's");
		seen.length = 0;

		const scoped = clients.createUserScopedDb(a.user.id);
		const rows = await scoped.category.findMany({});

		// RLS still decides what the call sees, and the slot saw the plain call.
		expect(rows.map((r) => r.name)).toEqual(["A's"]);
		expect(seen).toEqual(["Category.findMany"]);
	});

	it("rolls a transaction back when work inside it fails", async () => {
		const me = await createTestUser();
		await expect(
			userTransaction(clients.db, me.user.id, async (tx) => {
				await tx.category.create({
					data: { userId: me.user.id, name: "Gone", color: "blue" },
				});
				throw new Error("midway");
			}),
		).rejects.toThrow("midway");
		expect(
			await adminDb.category.count({ where: { userId: me.user.id } }),
		).toBe(0);
		expect(seen).toEqual(["Category.create"]);
	});

	it("runs raw SQL in the transaction as retrospend_app for the user", async () => {
		const me = await createTestUser();
		const [row] = await userTransaction(
			clients.db,
			me.user.id,
			(tx) => tx.$queryRaw<{ role: string; uid: string }[]>`
				SELECT current_user AS role, current_setting('app.current_user_id') AS uid`,
		);
		expect(row).toEqual({ role: "retrospend_app", uid: me.user.id });
	});

	it("keeps the scoped client's refusals with a slot in place", () => {
		const scoped = clients.createUserScopedDb("anyone") as unknown as Record<
			string,
			unknown
		>;
		for (const member of ["$queryRaw", "$executeRaw", "$extends", "$parent"])
			expect(() => (scoped[member] as () => void)?.()).toThrow(member);
		expect(() =>
			(scoped.$transaction as (ops: unknown[]) => unknown)([]),
		).toThrow(/userTransaction/);
	});
});

describe("the keystore facade", () => {
	it("never passes the slot, and still reaches the keystore as the user", async () => {
		const me = await createTestUser();
		const master = new Keyring([{ id: 1, key: randomBytes(32) }]);

		const keys = await userTransaction(
			clients.keystoreDb,
			me.user.id,
			async (tx) => {
				await tx.category.count({ where: { userId: me.user.id } });
				return getOrCreateDataKeyring(tx, master);
			},
		);

		expect(keys.ids).toEqual([1]);
		// The model call ran on the raw base: the slot never saw it.
		expect(seen).toEqual([]);
		// The facade has the three members the keystore needs and no others.
		expect(Object.keys(clients.keystoreDb).sort()).toEqual([
			"$executeRaw",
			"$queryRaw",
			"$transaction",
		]);
	});
});
