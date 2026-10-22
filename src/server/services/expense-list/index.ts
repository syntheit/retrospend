/**
 * listActivity: the Activity read (expense.listV2). Keys come from one SQL
 * union (query.ts), rows are shaped for the page only (rows.ts), and the
 * first page also carries the count and the footer total from spent().
 * Everything runs in one userTransaction, so the raw SQL is under RLS too.
 */

import {
	dayKey,
	normalizeTimeZone,
	parseDateOnlyIn,
	startOfNextDayIn,
} from "@retrospend/domain/time-zone";
import { TRPCError } from "@trpc/server";
import { userTransaction } from "~/server/db-tx";
import { findExchangeRate } from "~/server/exchange-rates";
import type { Prisma, PrismaClient } from "~prisma";
import { getExcludedProjectIds } from "../shared-expense-integration";
import { countKeys, type KeyQuery, type ListBounds, pageKeys } from "./query";
import { shapeRows } from "./rows";
import { decodeCursor, encodeCursor } from "./search";
import { activitySpent, spentFilterOf } from "./spent-seam";
import type { ListV2Filter, ListV2Result } from "./types";

type Db = PrismaClient | Prisma.TransactionClient;

/** The filter's days as instants in the viewer's zone: from its start, to the start of the day after `to`. */
export function boundsOf(filter: ListV2Filter, timeZone?: string): ListBounds {
	const bounds: ListBounds = {};
	if (filter.from) bounds.gte = parseDateOnlyIn(filter.from, timeZone);
	if (filter.to)
		bounds.lt = startOfNextDayIn(
			parseDateOnlyIn(filter.to, timeZone),
			timeZone,
		);
	return bounds;
}

export async function listActivity(
	db: Db,
	userId: string,
	filter: ListV2Filter,
	requestZone?: string,
	now: Date = new Date(),
): Promise<ListV2Result> {
	const timeZone = normalizeTimeZone(requestZone);
	const after = filter.cursor ? decodeCursor(filter.cursor) : null;
	if (filter.cursor && !after)
		throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown cursor" });
	const bounds = boundsOf(filter, timeZone);

	return userTransaction(db as PrismaClient, userId, async (tx) => {
		const user = await tx.user.findUnique({
			where: { id: userId },
			select: { homeCurrency: true },
		});
		const home = user?.homeCurrency ?? "USD";
		const [homeRate, excludedProjectIds] = await Promise.all([
			findExchangeRate(tx, home, now),
			getExcludedProjectIds(tx, userId),
		]);
		const k: KeyQuery = { userId, filter, bounds, excludedProjectIds };
		const keys = await pageKeys(tx, k, after, filter.limit + 1);
		const page = keys.slice(0, filter.limit);
		const last = page[page.length - 1];
		const items = await shapeRows(tx, page, {
			userId,
			timeZone,
			rates: { home, homeRate: homeRate?.rate ?? null },
		});
		const first = !after;
		const spentFilter = first ? spentFilterOf(userId, filter, bounds) : null;
		return {
			items,
			nextCursor:
				keys.length > filter.limit && last ? encodeCursor(last) : null,
			today: dayKey(now, timeZone),
			homeCurrency: home,
			count: first ? await countKeys(tx, k) : null,
			total: spentFilter ? await activitySpent(tx, spentFilter, home) : null,
		};
	});
}
