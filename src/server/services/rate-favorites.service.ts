import { TRPCError } from "@trpc/server";
import type { db as globalDb } from "~/server/db";
import { userTransaction } from "~/server/db-tx";
import type { ExchangeRate } from "~prisma";

type AppDb = typeof globalDb;

/**
 * Pinned exchange rates ("favorites"), shared by the tRPC preferences
 * router and /api/v1/settings/favorite-rates. `order` is unique per user,
 * so new pins go last and a reorder moves rows through negative orders
 * first to never collide mid-way.
 */

export type FavoriteRate = {
	exchangeRateId: string;
	order: number;
	exchangeRate: ExchangeRate;
};

/** The caller's pins in their order; `afterOrder` starts after that pin. */
export async function listFavoriteRates(
	db: AppDb,
	userId: string,
	page: { afterOrder?: number; take?: number } = {},
): Promise<FavoriteRate[]> {
	const rows = await db.exchangeRateFavorite.findMany({
		where: {
			userId,
			...(page.afterOrder !== undefined
				? { order: { gt: page.afterOrder } }
				: {}),
		},
		include: { exchangeRate: true },
		orderBy: { order: "asc" },
		...(page.take !== undefined ? { take: page.take } : {}),
	});
	return rows.map((f) => ({
		exchangeRateId: f.exchangeRateId,
		order: f.order,
		exchangeRate: f.exchangeRate,
	}));
}

/** Pins a rate last. Pinning one already pinned returns it unchanged. */
export async function addFavoriteRate(
	db: AppDb,
	userId: string,
	exchangeRateId: string,
): Promise<FavoriteRate> {
	const rate = await db.exchangeRate.findUnique({
		where: { id: exchangeRateId },
	});
	if (!rate) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Exchange rate not found",
		});
	}
	const existing = await db.exchangeRateFavorite.findUnique({
		where: { userId_exchangeRateId: { userId, exchangeRateId } },
	});
	if (existing) {
		return { exchangeRateId, order: existing.order, exchangeRate: rate };
	}
	const last = await db.exchangeRateFavorite.findFirst({
		where: { userId },
		orderBy: { order: "desc" },
		select: { order: true },
	});
	const created = await db.exchangeRateFavorite.create({
		data: { userId, exchangeRateId, order: (last?.order ?? -1) + 1 },
	});
	return { exchangeRateId, order: created.order, exchangeRate: rate };
}

/** Unpins a rate; true when it was pinned. */
export async function removeFavoriteRate(
	db: AppDb,
	userId: string,
	exchangeRateId: string,
): Promise<boolean> {
	const { count } = await db.exchangeRateFavorite.deleteMany({
		where: { userId, exchangeRateId },
	});
	return count > 0;
}

/** The web's star button: pin when unpinned, unpin when pinned. */
export async function toggleFavoriteRate(
	db: AppDb,
	userId: string,
	exchangeRateId: string,
): Promise<{ isFavorite: boolean }> {
	if (await removeFavoriteRate(db, userId, exchangeRateId)) {
		return { isFavorite: false };
	}
	await addFavoriteRate(db, userId, exchangeRateId);
	return { isFavorite: true };
}

/**
 * Puts the listed pins first, in that order, and the pins left out after
 * them in their old order. Ids that are not pinned are ignored.
 */
export async function reorderFavoriteRates(
	db: AppDb,
	userId: string,
	exchangeRateIds: string[],
): Promise<void> {
	await userTransaction(db, userId, async (tx) => {
		const pinned = await tx.exchangeRateFavorite.findMany({
			where: { userId },
			orderBy: { order: "asc" },
			select: { exchangeRateId: true },
		});
		const pinnedIds = pinned.map((f) => f.exchangeRateId);
		const listed = [...new Set(exchangeRateIds)].filter((id) =>
			pinnedIds.includes(id),
		);
		const order = [
			...listed,
			...pinnedIds.filter((id) => !listed.includes(id)),
		];
		const setOrder = (id: string, value: number) =>
			tx.exchangeRateFavorite.update({
				where: { userId_exchangeRateId: { userId, exchangeRateId: id } },
				data: { order: value },
			});
		// Two passes: through negative orders first, so no step ever puts
		// two rows on the same (userId, order).
		for (const [i, id] of order.entries()) await setOrder(id, -1 - i);
		for (const [i, id] of order.entries()) await setOrder(id, i);
	});
}
