import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma, PrismaClient } from "~prisma";

const transactionScope = new AsyncLocalStorage<true>();

/**
 * Whether the caller runs inside an interactive transaction a client opened
 * (userTransaction, a scoped or the global `$transaction`). The field-open
 * extension then loads no key: it would take a second pool connection while
 * the transaction holds one.
 */
export const inTransaction = (): boolean =>
	transactionScope.getStore() === true;

/** Runs a transaction callback so `inTransaction()` is true inside it. */
export const insideTransaction = <T>(work: () => Promise<T>): Promise<T> =>
	transactionScope.run(true, work);

/**
 * Runs `work` as if outside any transaction: for work a transaction starts
 * and does not wait for, on a connection of its own (a background key mint).
 */
export const outsideTransaction = <T>(work: () => T): T =>
	transactionScope.exit(work);

const previewScope = new AsyncLocalStorage<true>();

/**
 * Whether the caller runs inside a preview's transaction, which always rolls
 * back: the seal path makes no key there.
 */
export const inPreview = (): boolean => previewScope.getStore() === true;

/**
 * Runs a preview's work so `inPreview()` is true inside. The preview runner
 * (preview/runner.ts) calls it, so every runner built on it is covered.
 */
export const insidePreview = <T>(work: () => Promise<T>): Promise<T> =>
	previewScope.run(true, work);

const verbatimScope = new AsyncLocalStorage<true>();

/** Whether the caller runs inside `verbatim`. */
export const inVerbatim = (): boolean => verbatimScope.getStore() === true;

/**
 * Runs `work` so its writes store exactly the strings given: an undo putting
 * back cells as an audit entry kept them, sealed or not. A sealed value is
 * accepted only if it opens under the AAD of the very row and column it is
 * written to (field-open.ts), so a cell copied from another row is refused.
 */
export const verbatim = <T>(work: () => Promise<T>): Promise<T> =>
	verbatimScope.run(true, work);

export interface UserTransactionOptions {
	readonly timeout?: number;
	readonly isolationLevel?: Prisma.TransactionIsolationLevel;
}

type TransactionClient = Pick<PrismaClient, "$transaction">;

/** A user's crypto client (db-core.ts) and the load of that user's keys. */
type CryptoClient = { client: TransactionClient; ready(): Promise<void> };

const cryptoClients = new WeakMap<object, (userId: string) => CryptoClient>();

/**
 * buildClients registers the global client and every scoped client it hands
 * out, so userTransaction can swap any of them for the crypto client of the
 * user the transaction runs as. Only it knows that user.
 */
export function registerClient(
	client: object,
	cryptoClientFor: (userId: string) => CryptoClient,
): void {
	cryptoClients.set(client, cryptoClientFor);
}

let fakesAllowed = false;

/**
 * Unit tests pass fake clients to code that opens a user transaction (the unit
 * setup file calls this); the real-Postgres suite and production never do, so
 * there a client db.ts did not build is refused. Throws outside tests.
 */
export function allowUnregisteredClientsForTests(allow = true): void {
	if (process.env.NODE_ENV !== "test")
		throw new Error("allowUnregisteredClientsForTests is for tests only");
	fakesAllowed = allow;
}

const keystoreClients = new WeakSet<object>();

/** db-core.ts registers the keystore facades it builds: the only clients `keystoreTransaction` takes. */
export function registerKeystoreClient(client: object): void {
	keystoreClients.add(client);
}

/** Opens `client`'s transaction with the RLS settings as its first statement. */
function runAs<T>(
	client: TransactionClient,
	userId: string,
	work: (tx: Prisma.TransactionClient) => Promise<T>,
	options: UserTransactionOptions | undefined,
): Promise<T> {
	return client.$transaction(
		(tx) =>
			insideTransaction(async () => {
				await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true),
				                            set_config('role', 'retrospend_app', true)`;
				return work(tx);
			}),
		options,
	);
}

/** Each open user transaction's client, mapped to the user it runs as. Keystore transactions are never in it. */
const openTransactions = new WeakMap<object, string>();

/**
 * Runs `work` in one interactive transaction with RLS set for `userId`.
 * The RLS settings are the first statement inside it.
 *
 * Pass the global `db` or a client from createUserScopedDb: either is swapped
 * for `userId`'s crypto client (the raw base plus the extension slot with that
 * user's keys, db-core.ts), whose keys load before the transaction opens, on
 * their own connection. So `tx` is never the per-query wrapper that would
 * split the work across connections, and no keystore query runs inside it.
 * A transaction client this function opened joins its own transaction when
 * passed back for the same user (a service called from inside a money write);
 * `options` then do not apply, and another user throws.
 * Any other client throws: it would run model calls with no sealing, so a
 * script's own `new PrismaClient` copies ciphertext as text or writes
 * plaintext. Keystore work uses `keystoreTransaction`.
 *
 * `userId` is who the whole transaction runs as, whatever scoped client was
 * passed: `userTransaction(scopedForAlice, bobId, ...)` runs every query as
 * Bob, with Bob's keys. Pass the caller's own id unless acting for someone
 * else is intended.
 */
export async function userTransaction<T>(
	client: TransactionClient,
	userId: string,
	work: (tx: Prisma.TransactionClient) => Promise<T>,
	options?: UserTransactionOptions,
): Promise<T> {
	const openFor = openTransactions.get(client);
	if (openFor === userId) return work(client as Prisma.TransactionClient);
	if (openFor !== undefined)
		throw new Error(
			"userTransaction cannot switch users inside an open transaction",
		);
	const cryptoClientFor = cryptoClients.get(client);
	const joinable = (tx: Prisma.TransactionClient) => {
		openTransactions.set(tx, userId);
		return work(tx);
	};
	if (!cryptoClientFor && fakesAllowed)
		return runAs(client, userId, joinable, options);
	if (!cryptoClientFor)
		throw new Error(
			"userTransaction needs the client from db.ts (the global db or a user-scoped one); use keystoreTransaction for key work",
		);
	const crypto = cryptoClientFor(userId);
	await crypto.ready();
	return runAs(crypto.client, userId, joinable, options);
}

/**
 * The keystore's own path: the same transaction as `userTransaction`, on a
 * `keystoreDb` facade (db-core.ts) and never through the extension, so key
 * work never waits for keys or seals anything. Any other client throws.
 */
export async function keystoreTransaction<T>(
	client: TransactionClient,
	userId: string,
	work: (tx: Prisma.TransactionClient) => Promise<T>,
	options?: UserTransactionOptions,
): Promise<T> {
	if (!keystoreClients.has(client))
		throw new Error("keystoreTransaction takes keystoreDb only");
	return runAs(client, userId, work, options);
}
