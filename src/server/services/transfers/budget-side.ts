/**
 * The budget's half of a money move (MONEY-MOVES §5.2): a crossing transfer
 * becomes a TO_WEALTH or FROM_WEALTH movement, and a Move in a count-only
 * FROM_WEALTH, in the envelope budget's `WealthTransfer` (M8, track 2B P4,
 * envelope/wealth.service.ts). Without an envelope budget nothing is
 * written and the result says so; callers still report the effect they
 * computed, so previews can show it.
 */
import type { Money } from "~/server/figures/registry";
import type { Prisma } from "~prisma";
import { recordWealthMove, removeMoveIn } from "../envelope/wealth.service";

export interface BudgetMovement {
	/** The budget side's id when the caller names it (a Move in without income); else one is made. */
	readonly id?: string | null;
	readonly userId: string;
	readonly direction: "TO_WEALTH" | "FROM_WEALTH";
	/** The in-budget leg in the home (book) currency, as typed or booked. */
	readonly amount: Money;
	/** TO_WEALTH: the envelope it comes from; FROM_WEALTH: the one it goes into. Null = To assign. */
	readonly envelopeId: string | null;
	readonly date: Date;
	/** The account side, when money moved. */
	readonly transferId: string | null;
	/** A Move in counts without moving money (D4). */
	readonly countOnly: boolean;
	/** The kept income a Move in counts. */
	readonly sourceExpenseId: string | null;
	readonly assetAccountId: string | null;
}

export interface BudgetSideResult {
	readonly recorded: boolean;
	/** Why nothing was written: no budget, or a budget kept in another currency (02 §9.1 Q5). */
	readonly reason: "no_envelope_budget" | "other_currency" | null;
}

export async function recordBudgetSide(
	tx: Prisma.TransactionClient,
	movement: BudgetMovement,
): Promise<BudgetSideResult> {
	const r = await recordWealthMove(tx, movement);
	if (r.recorded) return { recorded: true, reason: null };
	return {
		recorded: false,
		reason: r.reason === "nothing_to_move" ? null : r.reason,
	};
}

/** The undo of a Move in takes its budget side with it. */
export function removeBudgetSide(
	tx: Prisma.TransactionClient,
	of: { sourceExpenseId: string } | { id: string },
): Promise<void> {
	return removeMoveIn(tx, of);
}
