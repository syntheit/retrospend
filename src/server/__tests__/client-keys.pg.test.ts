/**
 * Which keys each transaction gets, and when (E2EE D11 PR 3.1). The clients
 * are built on a base of the test's own that reports every statement, with a
 * slot that records whose keys each model call ran with, and keys that record
 * each `ready()`. Hand-derived expectations:
 *
 *   userTransaction(scoped for A, A)    -> A's keys, ready before the first statement
 *   userTransaction(db, A)              -> A's keys, not the global client's
 *   userTransaction(scoped for A, B)    -> B's keys, and RLS as B
 *   userTransaction(keystoreDb, A)      -> no slot, no ready
 *   scoped $transaction(callback)       -> the user's keys, ready first
 *   db.$transaction, both forms         -> the instance keys, ready first
 *   prismaAdapter(db) transaction       -> the instance keys, ready first
 *   real keys for B                     -> B's ring, loaded before BEGIN, nothing from the keystore inside
 */
import { randomBytes, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { BetterAuthOptions } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { Pool } from "pg";
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	type FieldAad,
	Keyring,
	openField,
	sealField,
} from "~/server/crypto/field-crypto";
import { type TextKeys, textKeys } from "~/server/crypto/text-keys";
import {
	buildClients,
	type ClientSlot,
	type KeySource,
	keystoreDb,
} from "~/server/db-core";
import { userTransaction } from "~/server/db-tx";
import {
	findDataKeyring,
	getOrCreateDataKeyring,
} from "~/server/services/keys/data-key.service";
import { findInstanceKeyring } from "~/server/services/keys/instance-key.service";
import { adminDb, createTestUser } from "~/test/pg-harness";
import { PrismaClient } from "~prisma";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const base = new PrismaClient({
	adapter: new PrismaPg(pool),
	log: [{ emit: "event", level: "query" }],
}) as unknown as NonNullable<Parameters<typeof buildClients>[1]>;
/** Statements on the test base and key events, in the order they happened. */
const events: string[] = [];
(
	base as unknown as {
		$on: (event: "query", run: (e: { query: string }) => void) => void;
	}
).$on("query", (e) => events.push(`sql ${e.query}`));
afterAll(async () => {
	await base.$disconnect();
	await pool.end();
});

/** Whose keys each model call in the slot ran with. */
const owners = new WeakMap<TextKeys, string>();
const seen: string[] = [];
const recordingSlot: ClientSlot = (client, keys) =>
	client.$extends({
		name: "recording-slot",
		query: {
			$allModels: {
				$allOperations({ args, query }) {
					seen.push(owners.get(keys) ?? "unknown");
					return query(args);
				},
			},
		},
	}) as unknown as typeof client;

/** Keys with no loaders whose `ready()` leaves an event. */
function spyKeys(who: string): TextKeys {
	const inner = textKeys({});
	const keys: TextKeys = {
		...inner,
		ready: async () => {
			events.push(`ready ${who}`);
			await inner.ready();
		},
	};
	owners.set(keys, who);
	return keys;
}

const spySource: KeySource = { instance: spyKeys("instance"), user: spyKeys };
const clients = buildClients(spySource, base, recordingSlot);

beforeEach(() => {
	events.length = 0;
	seen.length = 0;
});

const firstSql = () => events.findIndex((e) => e.startsWith("sql "));
const readyIndex = (who: string) => events.indexOf(`ready ${who}`);

const category = (userId: string, name: string) =>
	adminDb.category.create({ data: { userId, name, color: "blue" } });

describe("userTransaction", () => {
	it("runs on the user's crypto client when handed their scoped client", async () => {
		const a = await createTestUser();
		await userTransaction(
			clients.createUserScopedDb(a.user.id),
			a.user.id,
			(tx) => tx.category.count(),
		);
		expect(seen).toEqual([a.user.id]);
		expect(readyIndex(a.user.id)).toBeGreaterThanOrEqual(0);
		expect(readyIndex(a.user.id)).toBeLessThan(firstSql());
	});

	it("runs on the user's crypto client when handed the global client", async () => {
		const a = await createTestUser();
		await userTransaction(clients.db, a.user.id, (tx) => tx.category.count());
		expect(seen).toEqual([a.user.id]);
		expect(readyIndex(a.user.id)).toBeLessThan(firstSql());
		expect(readyIndex("instance")).toBe(-1);
	});

	it("takes the keys of the user it runs as, not the scoped client's", async () => {
		const [a, b] = await Promise.all([createTestUser(), createTestUser()]);
		await category(b.user.id, "B's");
		const names = await userTransaction(
			clients.createUserScopedDb(a.user.id),
			b.user.id,
			async (tx) => (await tx.category.findMany({})).map((c) => c.name),
		);
		expect(names).toEqual(["B's"]);
		expect(seen).toEqual([b.user.id]);
		expect(readyIndex(a.user.id)).toBe(-1);
		expect(readyIndex(b.user.id)).toBeLessThan(firstSql());
	});

	it("never swaps or waits on the keystore facade", async () => {
		const a = await createTestUser();
		await userTransaction(clients.keystoreDb, a.user.id, (tx) =>
			tx.category.count(),
		);
		expect(seen).toEqual([]);
		expect(events.filter((e) => e.startsWith("ready "))).toEqual([]);
	});
});

describe("transactions on the clients", () => {
	it("a scoped transaction waits for the user's keys", async () => {
		const a = await createTestUser();
		await clients
			.createUserScopedDb(a.user.id)
			.$transaction((tx) => tx.category.count());
		expect(seen).toEqual([a.user.id]);
		expect(readyIndex(a.user.id)).toBeLessThan(firstSql());
	});

	it("db.$transaction waits for the instance keys, in the callback form", async () => {
		await clients.db.$transaction((tx) => tx.category.count());
		expect(seen).toEqual(["instance"]);
		expect(readyIndex("instance")).toBeGreaterThanOrEqual(0);
		expect(readyIndex("instance")).toBeLessThan(firstSql());
	});

	it("db.$transaction waits for the instance keys, in the array form", async () => {
		const [count] = await clients.db.$transaction([
			clients.db.category.count({ where: { userId: randomUUID() } }),
		]);
		expect(count).toBe(0);
		expect(seen).toEqual(["instance"]);
		expect(readyIndex("instance")).toBeLessThan(firstSql());
	});

	it("better-auth's adapter gets the overriding client, so its transactions wait too", async () => {
		const adapter = prismaAdapter(clients.db, { provider: "postgresql" })(
			{} as BetterAuthOptions,
		);
		// A where clause not on the id makes the adapter claim in a transaction.
		const consumed = await adapter.consumeOne({
			model: "verification",
			where: [{ field: "identifier", value: randomUUID() }],
		});
		expect(consumed).toBeNull();
		expect(readyIndex("instance")).toBeGreaterThanOrEqual(0);
		expect(readyIndex("instance")).toBeLessThan(firstSql());
		expect(
			events.some((e) => e.startsWith("sql ") && e.includes("verification")),
		).toBe(true);
	});
});

describe("with real keys", () => {
	const master = new Keyring([{ id: 1, key: randomBytes(32) }]);
	const instance = () => findInstanceKeyring(master);
	const realSource: KeySource = {
		instance: textKeys({ instance }),
		user: (userId) => {
			const keys = textKeys({
				user: () => findDataKeyring(userId, master),
				instance,
			});
			owners.set(keys, userId);
			return keys;
		},
	};
	const captured: TextKeys[] = [];
	const capturingSlot: ClientSlot = (client, keys) => {
		captured.push(keys);
		return recordingSlot(client, keys);
	};
	const realCapturing = buildClients(realSource, base, capturingSlot);

	afterEach(() => vi.restoreAllMocks());

	it("loads the other user's ring before the transaction and nothing from the keystore inside it", async () => {
		const [a, b] = await Promise.all([createTestUser(), createTestUser()]);
		const bRing = await userTransaction(keystoreDb, b.user.id, (tx) =>
			getOrCreateDataKeyring(tx, master),
		);
		const cell: FieldAad = { table: "expense", column: "title", rowId: "e1" };
		const sealed = sealField(bRing, "Rent", cell);
		const original = keystoreDb.$transaction;
		vi.spyOn(keystoreDb, "$transaction").mockImplementation(((
			...args: unknown[]
		) => {
			events.push("keystore begin");
			return (original as (...a: unknown[]) => Promise<unknown>)(
				...args,
			).finally(() => events.push("keystore end"));
		}) as typeof original);
		events.length = 0;
		captured.length = 0;

		await userTransaction(
			realCapturing.createUserScopedDb(a.user.id),
			b.user.id,
			(tx) => tx.category.count(),
		);

		// The ring the transaction's client holds opens what B's key sealed.
		const ring = captured.at(-1)?.ring("user");
		expect(ring).toBeInstanceOf(Keyring);
		expect(openField(ring as Keyring, sealed, cell)).toBe("Rent");
		const begin = events.findIndex((e) => e.includes("set_config"));
		const keystore = events
			.map((e, i) => (e.startsWith("keystore ") ? i : -1))
			.filter((i) => i >= 0);
		expect(keystore.length).toBeGreaterThan(0);
		expect(Math.max(...keystore)).toBeLessThan(begin);
		expect(seen).toEqual([b.user.id]);
	});
});
