/**
 * An account's read view (MONEY-MOVES §4.6): its balance, how it is valued,
 * whether it is part of the budget, and its history of legs (income,
 * transfers, fees) and balance updates with their Not logged difference.
 */
import { TRPCError } from "@trpc/server";
import { userTransaction } from "~/server/db-tx";
import type { Prisma, PrismaClient } from "~prisma";
import { homeCurrencyOf } from "./ledger";
import { inBudget } from "./places";

export async function accountViewIn(
	tx: Prisma.TransactionClient,
	userId: string,
	accountId: string,
) {
	const account = await tx.assetAccount.findFirst({
		where: { id: accountId, userId },
		include: {
			legs: { orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 200 },
			rateTypes: { orderBy: [{ from: "asc" }, { createdAt: "asc" }] },
		},
	});
	if (!account) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Account not found" });
	}
	const home = await homeCurrencyOf(tx, userId);
	return {
		id: account.id,
		name: account.name,
		type: account.type,
		currency: account.currency,
		balance: account.balance.toString(),
		rateType: account.exchangeRateType,
		rateTypeHistory: account.rateTypes.map((r) => ({
			from: r.from.toISOString().slice(0, 10),
			type: r.type,
		})),
		inBudget: inBudget(account, home),
		countedUnits: account.countedUnits.toString(),
		closedAt: account.closedAt,
		legs: account.legs.map((leg) => ({
			id: leg.id,
			date: leg.date.toISOString().slice(0, 10),
			source: leg.source,
			amount: leg.amount.toString(),
			currency: leg.currency,
			transferId: leg.transferId,
			expenseId: leg.expenseId,
			/** A balance update's leg is its Not logged difference. */
			notLogged: leg.source === "BALANCE_UPDATE",
		})),
	};
}

export async function accountView(
	db: PrismaClient,
	userId: string,
	accountId: string,
) {
	return userTransaction(db, userId, (tx) =>
		accountViewIn(tx, userId, accountId),
	);
}
