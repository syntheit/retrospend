import { homeCurrencyOf, ratePickFor } from "~/server/services/accounts/ledger";
import { inBudget, worthOf } from "~/server/services/accounts/places";
import { homeValue, type RatePick } from "~/server/services/accounts/valuation";
import { accountViewIn } from "~/server/services/accounts/view";
import { dec, toMinor } from "~/server/services/envelope/units";
import type { Prisma } from "~prisma";
import { moneyOfText } from "../money-write";

type Tx = Prisma.TransactionClient;
type Row = Prisma.AssetAccountGetPayload<object>;

/** The account as the list and every write answers it. Dates are text so the answer is plain JSON. */
export function accountItem(row: Row, home: string, pick: RatePick) {
	const worth = worthOf(row.type, dec(row.balance.toString()));
	const value = homeValue(
		pick,
		{
			currency: row.currency,
			rateType: row.exchangeRateType,
			storedRate: row.exchangeRate,
		},
		worth,
		home,
		new Date(),
	);
	return {
		id: row.id,
		name: row.name,
		type: row.type,
		currency: row.currency,
		balance: moneyOfText(row.balance.toString(), row.currency),
		value:
			value === null ? null : { minor: toMinor(value, home), currency: home },
		inBudget: inBudget(row, home),
		isLiquid: row.isLiquid,
		rateType: row.exchangeRateType,
		closedAt: row.closedAt?.toISOString() ?? null,
		interestRate: row.interestRate?.toString() ?? null,
		minimumPayment: row.minimumPayment
			? moneyOfText(row.minimumPayment.toString(), row.currency)
			: null,
		dueDay: row.dueDate,
		updatedAt: row.updatedAt.toISOString(),
	};
}

export type AccountItem = ReturnType<typeof accountItem>;

/** Every account of the user, open and closed, oldest first. */
export async function accountItemsIn(tx: Tx, userId: string) {
	const rows = await tx.assetAccount.findMany({
		where: { userId },
		orderBy: { createdAt: "asc" },
	});
	const home = await homeCurrencyOf(tx, userId);
	const pick = await ratePickFor(tx, [home, ...rows.map((r) => r.currency)]);
	return { home, accounts: rows.map((r) => accountItem(r, home, pick)) };
}

/** One account, read in the caller's transaction so a write sees its own rows. */
export async function accountItemIn(
	tx: Tx,
	userId: string,
	id: string,
): Promise<AccountItem> {
	const row = await tx.assetAccount.findFirstOrThrow({ where: { id, userId } });
	const home = await homeCurrencyOf(tx, userId);
	const pick = await ratePickFor(tx, [home, row.currency]);
	return accountItem(row, home, pick);
}

/** An account with its newest legs and rate type history. */
export async function accountDetailIn(tx: Tx, userId: string, id: string) {
	const view = await accountViewIn(tx, userId, id);
	return {
		...(await accountItemIn(tx, userId, id)),
		countedUnits: moneyOfText(view.countedUnits, view.currency),
		rateTypeHistory: view.rateTypeHistory,
		legs: view.legs.map((leg) => ({
			id: leg.id,
			date: leg.date,
			source: leg.source,
			amount: moneyOfText(leg.amount, leg.currency),
			transferId: leg.transferId,
			expenseId: leg.expenseId,
			notLogged: leg.notLogged,
		})),
	};
}
