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

const globalForPrisma = globalThis as unknown as {
	prisma: ReturnType<typeof createPrismaClient> | undefined;
};

export const db = globalForPrisma.prisma ?? createPrismaClient();

if (env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/**
 * Creates a user-scoped Prisma client that sets the RLS context for every
 * model operation. Each individual query is wrapped in a batch transaction
 * that sets `app.current_user_id` and temporarily drops to the
 * `retrospend_app` role so Postgres enforces RLS policies.
 *
 * Interactive transactions (`$transaction(callback)`) must not use that
 * per-query wrapper: Prisma's `tx` inherits the extension, so every model call
 * inside would open its own batch transaction on another pool connection. The
 * work would not be atomic, would not see its own writes, and would block on
 * any row lock the real transaction holds (P2028 after 5 s). So the returned
 * client overrides `$transaction`: a callback runs on the base client, in one
 * transaction on one connection, with the RLS settings set once at its start
 * (transaction-local, so they end with it). Every query in it, model or raw,
 * then runs as `retrospend_app` for this user.
 */
export function createUserScopedDb(userId: string): typeof db {
	const extended = db.$extends({
		query: {
			$allModels: {
				async $allOperations({ args, query }) {
					const [, result] = await db.$transaction([
						db.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true),
						                      set_config('role', 'retrospend_app', true)`,
						query(args),
					]);
					return result;
				},
			},
		},
	}) as unknown as typeof db;

	function scopedTransaction(first: unknown, ...rest: unknown[]) {
		if (typeof first !== "function") {
			// A batch of already-scoped queries: each one carries its own context.
			return (extended.$transaction as (...args: unknown[]) => unknown)(
				first,
				...rest,
			);
		}
		const work = first as (tx: Prisma.TransactionClient) => Promise<unknown>;
		return (db.$transaction as (...args: unknown[]) => unknown)(
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
			const value = Reflect.get(target, prop, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
}
