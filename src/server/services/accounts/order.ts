/**
 * How the Wealth accounts are sorted and the custom order (Spotify's model):
 * the sort mode and the account ids you placed by dragging are two separate
 * facts, so switching the mode never touches the order. Stored in the WEALTH
 * page settings; the order only ever holds ids of your own accounts.
 */
import type { ACCOUNT_SORTS } from "@retrospend/api-contract";
import { TRPCError } from "@trpc/server";
import { userTransaction } from "~/server/db-tx";
import type { Prisma, PrismaClient } from "~prisma";
import { WealthSettingsSchema } from "../user-settings";

export type AccountOrder = {
	sort: (typeof ACCOUNT_SORTS)[number];
	order: string[];
};

async function readIn(
	tx: Prisma.TransactionClient,
	userId: string,
): Promise<ReturnType<typeof WealthSettingsSchema.parse>> {
	const row = await tx.userPageSetting.findUnique({
		where: { userId_page: { userId, page: "WEALTH" } },
	});
	const parsed = WealthSettingsSchema.safeParse(row?.settings);
	return parsed.success
		? parsed.data
		: WealthSettingsSchema.parse({
				version: 1,
				showCurrencyExposure: true,
				showHistoryChart: true,
			});
}

const pick = (s: AccountOrder): AccountOrder => ({
	sort: s.sort,
	order: s.order,
});

export function getAccountOrder(
	db: Pick<PrismaClient, "$transaction">,
	userId: string,
): Promise<AccountOrder> {
	return userTransaction(db, userId, async (tx) =>
		pick(await readIn(tx, userId)),
	);
}

/**
 * Saves the sort, the order or both; what is left out stays. The order is
 * replaced as a whole, and every id must be one of the user's accounts and
 * appear once, so a stale or foreign id is refused, never stored.
 */
export function setAccountOrder(
	db: Pick<PrismaClient, "$transaction">,
	userId: string,
	input: { sort?: AccountOrder["sort"]; order?: string[] },
): Promise<AccountOrder> {
	return userTransaction(db, userId, async (tx) => {
		if (input.order) {
			const ids = new Set(input.order);
			if (ids.size !== input.order.length)
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "An account appears twice in the order",
				});
			const own = await tx.assetAccount.count({
				where: { userId, id: { in: input.order } },
			});
			if (own !== ids.size)
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "The order has an account that is not yours",
				});
		}
		const current = await readIn(tx, userId);
		const next = {
			...current,
			...(input.sort !== undefined ? { sort: input.sort } : {}),
			...(input.order !== undefined ? { order: input.order } : {}),
		};
		await tx.userPageSetting.upsert({
			where: { userId_page: { userId, page: "WEALTH" } },
			update: { settings: next },
			create: { userId, page: "WEALTH", settings: next },
		});
		return pick(next);
	});
}
