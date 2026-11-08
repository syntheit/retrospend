import type { Prisma } from "~prisma";
import type { MoneyInEntry } from "./engine";
import { moneyInEntries } from "./entries";
import type { LoadedBook } from "./inputs";
import type { Minor, MonthKey } from "./types";

/**
 * The money the budget started with as of `month`, in book currency minor
 * units: the starting balance row, valued as the engine values it. It raises
 * To assign but is not money that came in, so "Money in" leaves it out and
 * the month's terms show it on its own line. Money in is cumulative through
 * the viewed month, so the row counts only from the month it is dated in (the
 * book's zone): a starting balance confirmed in November is not in October.
 * The entry is taken from the ones the book already loaded (no extra query:
 * Needs you reads this on every pass); a row behind a checkpoint is not among
 * them, so it is read from the row itself.
 */
export async function startingMoneyIn(
	tx: Prisma.TransactionClient,
	loaded: LoadedBook,
	month: MonthKey,
): Promise<Minor> {
	const id = loaded.row.startingBalanceExpenseId;
	if (!id) return 0;
	const entry =
		loaded.input.moneyIn.find((e) => e.id === id) ??
		(await read(tx, loaded, id));
	return entry && entry.month <= month ? entry.minor : 0;
}

async function read(
	tx: Prisma.TransactionClient,
	loaded: LoadedBook,
	id: string,
): Promise<MoneyInEntry | undefined> {
	const row = await tx.expense.findUnique({ where: { id } });
	return row ? moneyInEntries([row], loaded.valuer)[0] : undefined;
}
