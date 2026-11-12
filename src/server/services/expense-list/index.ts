/**
 * listActivity: the Activity read (expense.listV2). Keys come from one SQL
 * union (query.ts), rows are shaped for the page only (rows.ts), every page
 * carries its days' totals and the first page the count and the footer
 * total, both from spent() (totals.ts). The page runs in one
 * userTransaction, so the raw SQL is under RLS too. A text search on the
 * app-layer path (search-scan.ts) scans before it, in batches of their own,
 * and hands the matched keys in, so that transaction runs no search.
 */

import { periodRateDate } from "@retrospend/domain/money";
import {
	dayKey,
	normalizeTimeZone,
	parseDateOnlyIn,
	startOfNextDayIn,
} from "@retrospend/domain/time-zone";
import { TRPCError } from "@trpc/server";
import { preferredRateType } from "~/lib/rate-selection";
import { userTransaction } from "~/server/db-tx";
import { findExchangeRate } from "~/server/exchange-rates";
import type { Prisma, PrismaClient } from "~prisma";
import { getDefaultRateTypes } from "../rate-types";
import { searchesInAppLoaded } from "../search-fold";
import { getExcludedProjectIds } from "../shared-expense-integration";
import { countKeys, type KeyQuery, type ListBounds, pageKeys } from "./query";
import { shapeRows } from "./rows";
import { decodeCursor, encodeCursor } from "./search";
import { scanAny, scanKeys } from "./search-scan";
import {
	activityDayTotals,
	activitySpent,
	spentExpresses,
	type TotalsContext,
} from "./totals";
import {
	type ActivityRowDTO,
	type ListV2Filter,
	type ListV2Result,
	listV2Input,
} from "./types";

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
	/** App-layer search only: rows per scan batch, for tests. */
	options: { batch?: number } = {},
): Promise<ListV2Result> {
	const timeZone = normalizeTimeZone(requestZone);
	const after = filter.cursor ? decodeCursor(filter.cursor) : null;
	if (filter.cursor && !after)
		throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown cursor" });
	const bounds = boundsOf(filter, timeZone);
	const client = db as PrismaClient;
	const first = !after;

	// The path is picked here, once; the key parts never read the epoch.
	const inApp = !!filter.q?.trim() && (await searchesInAppLoaded());
	const k: KeyQuery = { userId, filter, bounds, excludedProjectIds: [] };
	if (inApp) {
		// The scan runs before the page, so it reads the hidden projects
		// first, on their own; the SQL path reads them inside the page.
		k.excludedProjectIds = await userTransaction(client, userId, (tx) =>
			getExcludedProjectIds(tx, userId),
		);
		// The first page scans every row (its count and "more" need them), a
		// later one stops once each source has the page and one more.
		k.matched = await scanKeys(client, k, {
			after,
			stop: first ? Number.POSITIVE_INFINITY : filter.limit + 1,
			batch: options.batch,
		});
	}

	const list: ListV2Result = await userTransaction(
		client,
		userId,
		async (tx) => {
			const user = await tx.user.findUnique({
				where: { id: userId },
				select: { homeCurrency: true },
			});
			const home = user?.homeCurrency ?? "USD";
			const [homeRate, defaults, excludedProjectIds] = await Promise.all([
				findExchangeRate(tx, home, now),
				getDefaultRateTypes(tx, userId),
				inApp ? k.excludedProjectIds : getExcludedProjectIds(tx, userId),
			]);
			k.excludedProjectIds = excludedProjectIds;
			// A key whose row was deleted since the scan has no row here and is
			// dropped (activityRowsFrom); the count may be one high this once.
			const keys = await pageKeys(tx, k, after, filter.limit + 1);
			const page = keys.slice(0, filter.limit);
			const last = page[page.length - 1];
			const more = keys.length > filter.limit;
			const rates = { home, homeRate: homeRate?.rate ?? null };
			const items = await shapeRows(tx, page, {
				userId,
				timeZone,
				rates,
				defaultRateType: preferredRateType(home, defaults),
			});
			// Totals convert at the rate of the range's last moment (or now if
			// sooner), as Insights does, so a past month reads the same in both.
			const totalsRate = bounds.lt
				? ((
						await findExchangeRate(
							tx,
							home,
							periodRateDate(new Date(bounds.lt.getTime() - 1), now),
						)
					)?.rate ?? null)
				: rates.homeRate;
			const totals: TotalsContext = {
				userId,
				home,
				homeRate: totalsRate,
				excludedProjectIds,
				timeZone,
				missingRates: new Set(),
			};
			const spent = spentExpresses(filter);
			return {
				items,
				nextCursor: more && last ? encodeCursor(last) : null,
				today: dayKey(now, timeZone),
				homeCurrency: home,
				// A first page that holds everything is its own count.
				count: first ? (more ? await countKeys(tx, k) : page.length) : null,
				total:
					first && spent
						? await activitySpent(tx, totals, filter, bounds)
						: null,
				dayTotals: spent
					? await activityDayTotals(tx, totals, filter, bounds, page)
					: null,
				missingRates: [...totals.missingRates].sort(),
				// Whether rows match outside the dates; an app-layer search scans
				// for it after this transaction.
				elsewhere:
					first && !page.length && (bounds.gte || bounds.lt) && !inApp
						? (await pageKeys(tx, { ...k, bounds: {} }, null, 1)).length > 0
						: null,
			};
		},
	);
	// A first page's count is 0 exactly when it is empty.
	if (inApp && list.count === 0 && (bounds.gte || bounds.lt))
		list.elsewhere = await scanAny(client, { ...k, bounds: {} }, options.batch);
	return list;
}

/** An Activity id as the list sends it: an expense id, `shared:<id>` or `payment:<key>`. */
function rowKeyOf(rowId: string): { src: "p" | "s" | "g"; id: string } {
	if (rowId.startsWith("shared:"))
		return { src: "s", id: rowId.slice("shared:".length) };
	if (rowId.startsWith("payment:"))
		return { src: "g", id: rowId.slice("payment:".length) };
	return { src: "p", id: rowId };
}

/**
 * One line of Activity by its id, shaped as the list shapes it, or null when
 * it is gone or not yours to see. Rows in projects you hide from analytics
 * are found too: a link to one still opens it.
 */
export async function activityRow(
	db: Db,
	userId: string,
	rowId: string,
	requestZone?: string,
	now: Date = new Date(),
): Promise<ActivityRowDTO | null> {
	const timeZone = normalizeTimeZone(requestZone);
	const only = rowKeyOf(rowId);
	return userTransaction(db as PrismaClient, userId, async (tx) => {
		const k: KeyQuery = {
			userId,
			filter: listV2Input.parse({ limit: 1 }),
			bounds: {},
			excludedProjectIds: [],
			only,
		};
		const keys = await pageKeys(tx, k, null, 1);
		if (keys.length === 0) return null;
		const user = await tx.user.findUnique({
			where: { id: userId },
			select: { homeCurrency: true },
		});
		const home = user?.homeCurrency ?? "USD";
		const [homeRate, defaults] = await Promise.all([
			findExchangeRate(tx, home, now),
			getDefaultRateTypes(tx, userId),
		]);
		const [row] = await shapeRows(tx, keys, {
			userId,
			timeZone,
			rates: { home, homeRate: homeRate?.rate ?? null },
			defaultRateType: preferredRateType(home, defaults),
		});
		return row ?? null;
	});
}
