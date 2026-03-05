import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { env } from "~/env";
import { PrismaClient } from "~prisma";

const pool = new Pool({
	connectionString: env.DATABASE_URL,
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
 * NOTE: This interceptor only wraps individual model queries. Interactive
 * transactions (`$transaction(callback)`) must manually call set_config at
 * the start of their callback — the `tx` client is not intercepted.
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
	});
	return extended as unknown as typeof db;
}
