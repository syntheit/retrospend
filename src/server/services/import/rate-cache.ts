/**
 * The rate table as one import reads it: each lookup (currency, day, side)
 * runs once and is shared by every row, so a 5,000-row statement makes a few
 * queries per currency and day instead of two per row. It lives for one
 * review or one commit, inside its transaction, so it never serves a rate
 * another write changed since.
 */
import type { Prisma, PrismaClient } from "~prisma";

type RateDb = Pick<
	PrismaClient | Prisma.TransactionClient,
	"exchangeRate" | "user"
>;

export function cachedRates(db: RateDb): RateDb {
	const memo = new Map<string, Promise<unknown>>();
	const findMany = (args: unknown) => {
		const key = JSON.stringify(args);
		let hit = memo.get(key);
		if (!hit) {
			hit = (db.exchangeRate.findMany as (a: unknown) => Promise<unknown>)(
				args,
			);
			memo.set(key, hit);
		}
		return hit;
	};
	return {
		user: db.user,
		exchangeRate: { findMany },
	} as unknown as RateDb;
}
