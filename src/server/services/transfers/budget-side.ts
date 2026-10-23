/**
 * The budget's half of a money move (MONEY-MOVES §5.2): a crossing transfer
 * becomes a TO_WEALTH or FROM_WEALTH movement, and a Move in a count-only
 * FROM_WEALTH, in the envelope budget's `WealthTransfer` (M8, track 2B P4).
 *
 * Seam: M6 and M8 are not on this branch, so there is no To assign or
 * envelope to move yet and this writes nothing. Every caller already passes
 * exactly what 2B needs to write (amount as the in-budget leg in book
 * currency, envelope, transfer or income), and reports the effect it
 * computed, so previews can show it. 2B replaces the body of `recordBudgetSide`
 * when WealthTransfer lands (docs/ui/GAPS.md, "Budget side of money moves").
 */
import type { Money } from "~/server/figures/registry";
import type { Prisma } from "~prisma";

export interface BudgetMovement {
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
	readonly reason: "no_envelope_budget" | null;
}

export async function recordBudgetSide(
	_tx: Prisma.TransactionClient,
	_movement: BudgetMovement,
): Promise<BudgetSideResult> {
	return { recorded: false, reason: "no_envelope_budget" };
}
