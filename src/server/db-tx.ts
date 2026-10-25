import type { Prisma, PrismaClient } from "~prisma";

export interface UserTransactionOptions {
	readonly timeout?: number;
	readonly isolationLevel?: Prisma.TransactionIsolationLevel;
}

/**
 * Runs `work` in one interactive transaction with RLS set for `userId`.
 * The RLS settings are the first statement inside it. Pass the global `db` or a
 * client from createUserScopedDb: the scoped client's `$transaction(callback)`
 * runs on the base client (one connection), so `tx` is never the per-query
 * wrapper that would split the work across connections.
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
