import type { MoneyInEntry } from "./engine";
import type { Minor, MonthKey } from "./types";

/** What the starting money read needs of a loaded book. */
export interface StartingMoneyBook {
	row: { startingBalanceExpenseId: string | null };
	input: { moneyIn: readonly MoneyInEntry[] };
}

/**
 * The money the budget started with as of `month`, in book currency minor
 * units: the starting balance row, valued as the engine values it. It raises
 * To assign but is not money that came in, so "Money in" leaves it out and
 * the month's terms show it on its own line. Money in is cumulative through
 * the viewed month, so the row counts only from the month it is dated in (the
 * book's zone): a starting balance confirmed in November is not in October.
 * The entry is taken from the ones the book already loaded (no extra query:
 * Needs you reads this on every pass); a row behind a checkpoint is not among
 * them, so the source reads the row itself (`readEntry`).
 */
export async function startingMoneyIn(
	loaded: StartingMoneyBook,
	month: MonthKey,
	readEntry: (id: string) => Promise<MoneyInEntry | undefined>,
): Promise<Minor> {
	const id = loaded.row.startingBalanceExpenseId;
	if (!id) return 0;
	const entry =
		loaded.input.moneyIn.find((e) => e.id === id) ?? (await readEntry(id));
	return entry && entry.month <= month ? entry.minor : 0;
}
