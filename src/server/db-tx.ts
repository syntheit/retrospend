import type { Prisma, PrismaClient } from "~prisma";

export interface UserTransactionOptions {
	readonly timeout?: number;
	readonly isolationLevel?: Prisma.TransactionIsolationLevel;
}

/**
 * Runs `work` in one interactive transaction with RLS set for `userId`.
 * The RLS settings are the first statement inside it. Pass the global `db` or a
 * client from createUserScopedDb: the scoped client's `$transaction(callback)`
 * runs on the global client (one connection), so `tx` is never the per-query
 * wrapper that would split the work across connections. The global client is
 * the raw base plus the extension slot (db.ts), so the model calls in `tx` go
 * through the slot.
 *
 * `userId` is who the whole transaction runs as, whatever scoped client was
 * passed: `userTransaction(scopedForAlice, bobId, ...)` runs every query as
 * Bob. Pass the caller's own id unless acting for someone else is intended.
 */
export function userTransaction<T>(
	client: Pick<PrismaClient, "$transaction">,
	userId: string,
	work: (tx: Prisma.TransactionClient) => Promise<T>,
	options?: UserTransactionOptions,
): Promise<T> {
	return client.$transaction(async (tx) => {
		await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true),
		                            set_config('role', 'retrospend_app', true)`;
		return work(tx);
	}, options);
}
