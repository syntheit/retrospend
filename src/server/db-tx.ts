import type { Prisma, PrismaClient } from "~prisma";

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
	return (crypto?.client ?? client).$transaction(async (tx) => {
		await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true),
		                            set_config('role', 'retrospend_app', true)`;
		return work(tx);
	}, options);
}
