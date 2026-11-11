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
 * back: the seal path makes no key there (E2EE D11 PR 4 section 1).
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

/**
 * Runs `work` in one interactive transaction with RLS set for `userId`.
 * The RLS settings are the first statement inside it.
 *
 * Pass the global `db` or a client from createUserScopedDb: either is swapped
 * for `userId`'s crypto client (the raw base plus the extension slot with that
 * user's keys, db-core.ts), whose keys load before the transaction opens, on
 * their own connection. So `tx` is never the per-query wrapper that would
 * split the work across connections, and no keystore query runs inside it.
 * A client that was not registered (`keystoreDb`, a test's base) is used as
 * it is, so a keystore transaction never waits for keys.
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
	const crypto = cryptoClients.get(client)?.(userId);
	await crypto?.ready();
	return (crypto?.client ?? client).$transaction(
		(tx) =>
			insideTransaction(async () => {
				await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true),
				                            set_config('role', 'retrospend_app', true)`;
				return work(tx);
			}),
		options,
	);
}
