import type { Prisma } from "~prisma";
import { moneyInEntries } from "./entries";
import type { LoadedBook } from "./inputs";
import type { Minor } from "./types";

/**
 * The money the budget started with, in book currency minor units: the
 * starting balance row, valued as the engine values it. It raises To assign
 * but is not money that came in, so "Money in" leaves it out and the month's
 * terms show it on its own line. Read from the row itself, so a book whose
 * early months sit behind a checkpoint still finds it.
 */
export async function startingMoneyIn(
	tx: Prisma.TransactionClient,
	loaded: LoadedBook,
): Promise<Minor> {
	const id = loaded.row.startingBalanceExpenseId;
	if (!id) return 0;
	const row = await tx.expense.findUnique({ where: { id } });
	if (!row) return 0;
	return moneyInEntries([row], loaded.valuer)[0]?.minor ?? 0;
}
