import type { Money } from "@retrospend/domain/money-minor";
import type { BalancePreview } from "./source";

// What "Update balance" would do, from the server's dry run of the write. The
// account's own line and the difference that goes to Not logged come from the
// answer the write would give; every figure that moved (net worth and its
// parts) is laid out by the budget's figure lines. Nothing here adds or
// subtracts.

export interface BalanceRows {
	/** The account's balance in its own currency, before and after. */
	balance: { before: Money; after: Money } | null;
	/** The difference recorded as Not logged (not income, not spending). */
	notLogged: Money | null;
}

/** The figure the account's own line already says. */
export const ACCOUNT_BALANCE = "accounts.balance";

function isMoney(value: unknown): value is Money {
	const m = value as Money | null;
	return (
		typeof m === "object" &&
		m !== null &&
		typeof m.minor === "number" &&
		typeof m.currency === "string"
	);
}

export function balanceRows(preview: BalancePreview): BalanceRows {
	const result = (
		preview.detail as
			| { result?: { before?: unknown; after?: unknown; notLogged?: unknown } }
			| undefined
	)?.result;
	return {
		balance:
			result && isMoney(result.before) && isMoney(result.after)
				? { before: result.before, after: result.after }
				: null,
		notLogged:
			result && isMoney(result.notLogged) && result.notLogged.minor !== 0
				? result.notLogged
				: null,
	};
}

/** The balance is already what was typed: nothing to write. */
export function isUnchanged(rows: BalanceRows): boolean {
	return (
		rows.balance !== null &&
		rows.balance.before.minor === rows.balance.after.minor
	);
}
