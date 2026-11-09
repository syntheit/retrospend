import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { env } from "~/env";
import { type Prisma, PrismaClient } from "~prisma";

const pool = new Pool({
	connectionString: env.DATABASE_URL,
	max: 20,
	idleTimeoutMillis: 30000,
	connectionTimeoutMillis: 5000,
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
 */
const rawBase: RawClient = globalForPrisma.prisma ?? createPrismaClient();

if (env.NODE_ENV !== "production") globalForPrisma.prisma = rawBase;

/**
 * The slot is where lane D11 puts the field-encryption extension: it seals
 * mapped columns on write and opens them on read, so it sits on every client
 * that reads or writes user text and on the transactions they open (an
 * interactive transaction's `tx` inherits its client's query extensions).
 * Today it does nothing: it passes every query on unchanged. On a scoped
 * client the slot is outside the per-query RLS batch, so a slot extension sees
 * the plain model call and never the `set_config` batch around it.
 */
export type ClientSlot = (client: RawClient) => RawClient;

const passthroughSlot: ClientSlot = (client) =>
	client.$extends({
		name: "text-slot",
		query: { $allModels: { $allOperations: ({ args, query }) => query(args) } },
	}) as unknown as RawClient;

/**
 * The keystore calls (the functions that read and mint a user's data keys)
 * stay off the slot: the slot's extension will load keys through them, so
 * running them through it would call itself. The three members the keystore
 * needs, bound to the raw base.
 */
export type KeystoreClient = Pick<
	RawClient,
	"$transaction" | "$executeRaw" | "$queryRaw"
>;

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

/**
 * Builds the clients on `base`, each through `slot`: the global client, the
 * user-scoped factory, and the keystore facade (which skips the slot). The
 * app builds them once below; a test passes its own base and slot.
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
 * client overrides `$transaction`: a callback runs on the global client (the
 * base plus the slot), in one transaction on one connection, with the RLS
 * settings set once at its start (transaction-local, so they end with it).
 * Every query in it, model or raw, then runs as `retrospend_app` for this
 * user, and its model calls go through the slot.
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
	base: RawClient,
	slot: ClientSlot = passthroughSlot,
) {
	const global = slot(base);

	const keystore: KeystoreClient = {
		$transaction: base.$transaction.bind(base),
		$executeRaw: base.$executeRaw.bind(base),
		$queryRaw: base.$queryRaw.bind(base),
	};

	function createUserScopedDb(userId: string): RawClient {
		const batched = base.$extends({
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
		const extended = slot(batched);

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
			return (global.$transaction as (...args: unknown[]) => unknown)(
				async (tx: Prisma.TransactionClient) => {
					await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true),
					                            set_config('role', 'retrospend_app', true)`;
					return work(tx);
				},
				...rest,
			);
		}

		return new Proxy(extended, {
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
	}

	return { db: global, createUserScopedDb, keystoreDb: keystore };
}

const clients = buildClients(rawBase);

export const db = clients.db;

/** A user-scoped client for `userId`; see `buildClients` for what it refuses. */
export const createUserScopedDb = clients.createUserScopedDb;

/** Keystore calls only: the raw base, never through the slot. */
export const keystoreDb = clients.keystoreDb;
