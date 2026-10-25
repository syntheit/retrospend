import type { Money } from "@retrospend/domain/money-minor";
import type { BalancePreview } from "./source";

// What "Update balance" would do, from the server's dry run of the write: the
// account's balance, net worth (home currency) and the difference that goes
// to Not logged. Nothing here adds or subtracts.

export interface BalanceRows {
	/** The account's balance in its own currency, before and after. */
	balance: { before: Money; after: Money } | null;
	/** Net worth in the home currency; null when a missing rate leaves it out. */
	netWorth: { before: Money | null; after: Money | null } | null;
	/** The difference recorded as Not logged (not income, not spending). */
	notLogged: Money | null;
}

function isMoney(value: unknown): value is Money {
	const m = value as Money | null;
	return (
		typeof m === "object" &&
		m !== null &&
		typeof m.minor === "number" &&
		typeof m.currency === "string"
	);
}

function asMoney(
	line: { minor: number; currency: string } | null,
): Money | null {
	return line && line.currency !== "%" ? line : null;
}

export function balanceRows(preview: BalancePreview): BalanceRows {
	const result = (
		preview.detail as
			| { result?: { before?: unknown; after?: unknown; notLogged?: unknown } }
			| undefined
	)?.result;
	const net = preview.changes.find((c) => c.id === "netWorth");
	return {
		balance:
			result && isMoney(result.before) && isMoney(result.after)
				? { before: result.before, after: result.after }
				: null,
		netWorth: net
			? { before: asMoney(net.before), after: asMoney(net.after) }
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
