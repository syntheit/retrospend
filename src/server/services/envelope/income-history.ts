/**
 * Budget income (SPEC §12.3): income rows entering To assign, at book value.
 * What it means (this month's income, typical income, the % base) is pure and
 * lives in @retrospend/domain/envelope/income-history, shared with devices;
 * here: the read of the closed months' income rows, and the freezing of what
 * valuing them valued for the first time.
 */
import {
	type ClosedIncomes,
	closedIncomesFrom,
	groupBaseFrom,
} from "@retrospend/domain/envelope/income-history";
import type { Prisma } from "~prisma";
import { budgetMoneyInWhere } from "../spending";
import type { GroupBase } from "./group-view";
import type { LoadedBook } from "./inputs";
import { freeze } from "./load-state";
import type { MonthKey } from "./types";

type Tx = Prisma.TransactionClient;

export {
	type ClosedIncomes,
	hasPercentGroup,
	incomeIn,
} from "@retrospend/domain/envelope/income-history";

/** Budget income of the last 3 closed months before the current one, oldest first. */
export async function closedIncomes(
	tx: Tx,
	loaded: LoadedBook,
): Promise<ClosedIncomes> {
	let read = false;
	const closed = await closedIncomesFrom(async ({ from, to }) => {
		read = true;
		return tx.expense.findMany({
			where: {
				...budgetMoneyInWhere(loaded.row.createdById, from),
				entryKind: "STANDARD",
				date: { gte: from, lt: to },
			},
			select: {
				id: true,
				amount: true,
				currency: true,
				amountInUSD: true,
				date: true,
				categoryId: true,
				recurringTemplateId: true,
				direction: true,
				entryKind: true,
				homeCurrency: true,
				homeAmount: true,
			},
		});
	}, loaded);
	// Values this read made for the first time are frozen like the load's own.
	if (read) await freeze(tx, loaded.row.id, loaded.valuer);
	return closed;
}

/** The % base for `month` (SPEC §5.9): its own income, else typical income. */
export function groupBaseFor(
	tx: Tx,
	loaded: LoadedBook,
	month: MonthKey,
): Promise<GroupBase | null> {
	return groupBaseFrom(() => closedIncomes(tx, loaded), loaded, month);
}
