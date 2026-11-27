/**
 * What the device's transfer writes share (transfer-create-local.ts and
 * transfer-delete-local.ts): the refusals as the port's errors, the typed
 * "online" outcome, and the one place the budget's line is read.
 *
 * The rules are the domain's (transfers/plan, rows, refusals); this file adds
 * only what a device cannot do. The device books a move only when it can see
 * the whole budget and the move does not touch it; everything else is the
 * server's, and the write refuses with a TransferOnlineError (an
 * InvalidInputError, so the outbox and the preview compare treat it as "the
 * server decides") and writes nothing.
 */
import { TransferRefusal } from "@retrospend/domain/transfers/refusals";
import type { TransferRows } from "@retrospend/domain/transfers/rows";
import { refusingAccount } from "./account-kit";
import { InvalidInputError } from "./port";
import type { Repos } from "./repos";

/** Why a transfer write is left to the server, as a code a screen can map to its words. */
export type OnlineReason =
	/** The budget cannot be read in full: the device holds no book (or not all of it yet), so it cannot tell whether the move touches it. */
	| "budget_not_ready"
	/** The budget side needs a rate the device has none for (budgetEffect is "unavailable"). */
	| "budget_unavailable"
	/** The move crosses the budget line while a book in the home currency exists: the server records its budget side. */
	| "crosses_budget"
	/** The transfer's own rows are not all on the device (an older pull), so what to take back is unknown. */
	| "incomplete_transfer"
	/** The move has a budget side (a Wealth transfer row) the server takes away with it. */
	| "has_budget_side";

export const TRANSFER_ONLINE = "This move is handled online";

export class TransferOnlineError extends InvalidInputError {
	constructor(readonly reason: OnlineReason) {
		super(TRANSFER_ONLINE);
	}
}

/** The domain's refusals as the port's errors, with the domain's words (the account kit's, plus a transfer's own). */
export const refusingTransfer = <T>(run: () => T | Promise<T>): Promise<T> =>
	refusingAccount(async () => {
		try {
			return await run();
		} catch (e) {
			if (e instanceof TransferRefusal) throw new InvalidInputError(e.message);
			throw e;
		}
	});

/**
 * Whether the budget reads whole: ready, or no book at all once the pull of
 * the budget's entities has finished (`budgetPulled`: a Just track person).
 * Without that, "none" is a book that may not have arrived, and the server decides.
 */
export function budgetReadable(r: Repos, budgetPulled: boolean): boolean {
	const status = r.budget.status();
	return status === "ready" || (status === "none" && budgetPulled);
}

/**
 * Throws TransferOnlineError unless the device may book this move's budget
 * side as "nothing to record". Fail closed: a budget the device cannot read in
 * full, a side it has no rate for and a crossing into a book the server writes
 * to are all the server's.
 */
export function refuseOnlineBudget(
	r: Repos,
	rows: TransferRows,
	budgetPulled = false,
): void {
	if (!budgetReadable(r, budgetPulled))
		throw new TransferOnlineError("budget_not_ready");
	const { budget } = rows;
	if (budget.effect === "unavailable")
		throw new TransferOnlineError("budget_unavailable");
	if (budget.effect !== "leaves" && budget.effect !== "enters") return;
	// The server's recordWealthMove writes a side only into a book with a
	// default envelope, in the currency of the amount (the home currency).
	const book = r.budget.book();
	if (book?.defaultEnvelopeId && book.currency === budget.currency)
		throw new TransferOnlineError("crosses_budget");
}
