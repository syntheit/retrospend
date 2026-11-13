import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { env } from "~/env";
import type { RuntimeModels } from "~/server/crypto/model-graph";
import type { TextKeys } from "~/server/crypto/text-keys";
import { appPoolConfig } from "~/server/db-pool-config";
import { insideTransaction, registerClient } from "~/server/db-tx";
import { type Prisma, PrismaClient } from "~prisma";

const pool = new Pool(appPoolConfig(env.DATABASE_URL));

// A connection Postgres ends (the idle-in-transaction timeout) must not crash
// the process: the pool drops it and the next query opens a new one.
pool.on("error", (error) => {
	console.error("Database pool connection ended", error.message);
});

const adapter = new PrismaPg(pool);

const createPrismaClient = () =>
	new PrismaClient({
		adapter,
		log:
			env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
	});

type RawClient = ReturnType<typeof createPrismaClient>;

const globalForPrisma = globalThis as unknown as {
	prisma: RawClient | undefined;
};

/**
 * The one raw Prisma client. It is private to this file: every client the app
 * uses is built on it by `buildClients`, and the only part of it that leaves
 * is the keystore facade. Anything built on it directly would skip the slot.
 *
 * This file imports no service: the key services import `keystoreDb` from
 * here, and db.ts, the one composition point, wires them into the clients.
 */
const rawBase: RawClient = globalForPrisma.prisma ?? createPrismaClient();

if (env.NODE_ENV !== "production") globalForPrisma.prisma = rawBase;

/**
 * The generated client's runtime data model: models, their fields and
 * relation targets. Prisma 7 exposes it only on a private member, so this is
 * the one place that reaches for it; model-graph.test.ts fails if an upgrade
 * moves it.
 */
export function runtimeDataModel(): RuntimeModels {
	const data = (rawBase as unknown as { _runtimeDataModel?: RuntimeModels })
		._runtimeDataModel;
	if (!data?.models)
		throw new Error("The Prisma client has no runtime data model");
	return data;
}

/**
 * The slot is where lane D11 puts the field-encryption extension: it seals
 * mapped columns on write and opens them on read, so it sits on every client
 * that reads or writes user text and on the transactions they open (an
 * interactive transaction's `tx` inherits its client's query extensions).
 * `keys` are the rings that client may open with: the instance ring on the
 * global client, a user's ring and the instance ring on that user's clients.
 * Today it does nothing: it passes every query on unchanged. On a scoped
 * client the slot is outside the per-query RLS batch (it is added first, and
 * Prisma runs the first-added query extension outermost), so a slot extension
 * sees the plain model call, wraps the whole batch, and can call `query` again
 * to run another attempt under its own RLS context.
 */
export type ClientSlot = (client: RawClient, keys: TextKeys) => RawClient;

const passthroughSlot: ClientSlot = (client) =>
	client.$extends({
		name: "text-slot",
		query: { $allModels: { $allOperations: ({ args, query }) => query(args) } },
	}) as unknown as RawClient;

/** Where the clients get their keys; db.ts wires these to the key services. */
export interface KeySource {
	/** The global client's keys: the instance ring only. */
	readonly instance: TextKeys;
	/** The keys of one user's clients: that user's ring and the instance ring. */
	user(userId: string): TextKeys;
}

/**
 * The keystore calls (the functions that read and mint keys) stay off the
 * slot: the slot's extension loads keys through them, so running them through
 * it would call itself. The three members the keystore needs, bound to the
 * raw base. It is not registered with userTransaction, so a keystore
 * transaction never swaps to a crypto client or waits for keys.
 */
export type KeystoreClient = Pick<
	RawClient,
	"$transaction" | "$executeRaw" | "$queryRaw"
>;

const keystoreFacade = (base: RawClient): KeystoreClient => ({
	$transaction: base.$transaction.bind(base),
	$executeRaw: base.$executeRaw.bind(base),
	$queryRaw: base.$queryRaw.bind(base),
});

/** Keystore calls only: the raw base, never through the slot. */
export const keystoreDb = keystoreFacade(rawBase);

const REFUSED_ON_SCOPED = [
	"$queryRaw",
	"$executeRaw",
	"$queryRawUnsafe",
	"$executeRawUnsafe",
	"$queryRawTyped",
	"$executeRawTyped",
] as const;

function refusedOnScoped(method: string, hint: string): never {
	throw new Error(
		`${method} is not allowed on a user-scoped client: it would reach the owner connection without RLS. ${hint}`,
	);
}

type AnyTransaction = (...args: unknown[]) => Promise<unknown>;

/**
 * Builds the clients on `base`, each through `slot`: the global client, the
 * user-scoped factory, and the keystore facade (which skips the slot). db.ts
 * builds the app's once; a test passes its own keys, base and slot.
 *
 * Keys are loaded before a transaction opens, never inside one: a keystore
 * load inside would take a second pool connection while holding the first,
 * and inside a preview it would run in the preview's snapshot. So every
 * transaction entry awaits `ready()` first: the global client's
 * `$transaction` (both forms) awaits the instance keys, and a user's
 * transaction (scoped `$transaction`, or `userTransaction` on any registered
 * client) awaits that user's keys and runs on that user's crypto client.
 * `ready()` never throws, so a plaintext ledger with no master key or no
 * keystore runs as before.
 *
 * The scoped client sets the RLS context for every model operation. Each
 * individual query is wrapped in a batch transaction that sets
 * `app.current_user_id` and temporarily drops to the `retrospend_app` role so
 * Postgres enforces RLS policies.
 *
 * Interactive transactions (`$transaction(callback)`) must not use that
 * per-query wrapper: Prisma's `tx` inherits the extension, so every model call
 * inside would open its own batch transaction on another pool connection. The
 * work would not be atomic, would not see its own writes, and would block on
 * any row lock the real transaction holds (P2028 after 5 s). So the returned
 * client overrides `$transaction`: a callback runs on the user's crypto client
 * (the base plus the slot with the user's keys), in one transaction on one
 * connection, with the RLS settings set once at its start (transaction-local,
 * so they end with it). Every query in it, model or raw, then runs as
 * `retrospend_app` for this user, and its model calls go through the slot.
 *
 * Raw SQL, the array form of `$transaction`, and every other `$` member
 * (`$parent`, `$extends`, `$connect`, `$disconnect`, `$on`) are refused on the
 * scoped client: the per-query wrapper covers model calls only, so a raw
 * query on it would run on the owner connection with no role and no RLS, and
 * `$parent` or `$extends` would hand that connection back. Use
 * `userTransaction` for raw SQL as a user, or the global `db` for data that
 * has no owner (and say why where you do).
 */
export function buildClients(
	keys: KeySource,
	base: RawClient = rawBase,
	slot: ClientSlot = passthroughSlot,
) {
	const extendedGlobal = slot(base, keys.instance);

	// Built per call: the key services cache the rings, so a crypto client and
	// its keys cost no query, and none outlives the request that made it.
	const cryptoClientFor = (userId: string) => {
		const userKeys = keys.user(userId);
		return { client: slot(base, userKeys), ready: () => userKeys.ready() };
	};

	const globalTransaction = (first: unknown, ...rest: unknown[]) => {
		const arg =
			typeof first === "function"
				? (tx: unknown) =>
						insideTransaction(() => (first as (tx: unknown) => Promise<unknown>)(tx))
				: first;
		return keys.instance
			.ready()
			.then(() => (extendedGlobal.$transaction as AnyTransaction)(arg, ...rest));
	};

	// A Proxy only for the `$transaction` override. better-auth receives this
	// one too (`prismaAdapter(db)`), so its transactions wait for keys as well.
	const global = new Proxy(extendedGlobal, {
		get(target, prop) {
			if (prop === "$transaction") return globalTransaction;
			const value = Reflect.get(target, prop, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	registerClient(global, cryptoClientFor);

	function createUserScopedDb(userId: string): RawClient {
		const crypto = cryptoClientFor(userId);
		// Prisma runs the first query extension added outermost, so extending
		// the crypto client (the slot first) puts the slot outside this batch.
		const extended = crypto.client.$extends({
			query: {
				$allModels: {
					async $allOperations({ args, query }) {
						const [, result] = await base.$transaction([
							base.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true),
							                      set_config('role', 'retrospend_app', true)`,
							query(args),
						]);
						return result;
					},
				},
			},
		}) as unknown as RawClient;

		function scopedTransaction(first: unknown, ...rest: unknown[]) {
			if (typeof first !== "function") {
				// Raw promises in the array would run on the owner connection, and
				// model calls in it each carry their own context but are not one
				// atomic unit with a shared role. One callback form is the only path.
				return refusedOnScoped(
					"$transaction([...])",
					"Use userTransaction(db, userId, async (tx) => { ... }) instead.",
				);
			}
			const work = first as (tx: Prisma.TransactionClient) => Promise<unknown>;
			return crypto.ready().then(() =>
				(crypto.client.$transaction as AnyTransaction)(
					(tx: Prisma.TransactionClient) =>
						insideTransaction(async () => {
							await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true),
							                            set_config('role', 'retrospend_app', true)`;
							return work(tx);
						}),
					...rest,
				),
			);
		}

		const scoped = new Proxy(extended, {
			get(target, prop) {
				if (prop === "$transaction") return scopedTransaction;
				if (
					typeof prop === "string" &&
					(REFUSED_ON_SCOPED as readonly string[]).includes(prop)
				) {
					return () =>
						refusedOnScoped(
							prop,
							"Use userTransaction(db, userId, async (tx) => { ... }), or the global db for shared data.",
						);
				}
				// Every other `$` member is refused: `$parent` is the unwrapped client,
				// `$extends` returns one bound to it, and `$connect`, `$disconnect`
				// and `$on` act on the shared pool. `$$typeof` and the like are
				// inspection probes, not members.
				if (
					typeof prop === "string" &&
					prop.startsWith("$") &&
					!prop.startsWith("$$")
				) {
					refusedOnScoped(
						prop,
						"A scoped client offers model calls and $transaction(callback) only; use the global db explicitly for anything else.",
					);
				}
				const value = Reflect.get(target, prop, target);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
		registerClient(scoped, cryptoClientFor);
		return scoped;
	}

	return { db: global, createUserScopedDb, keystoreDb: keystoreFacade(base) };
}
