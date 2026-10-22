import type { Prisma, PrismaClient } from "~prisma";

export interface UserTransactionOptions {
	readonly timeout?: number;
	readonly isolationLevel?: Prisma.TransactionIsolationLevel;
}

/**
 * Runs `work` in one interactive transaction with RLS set for `userId`.
 * createUserScopedDb only intercepts single model calls; the `tx` client of
 * an interactive transaction is not intercepted, so the RLS settings must be
 * the first statement inside it (the pattern in routers/wealth.ts).
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
