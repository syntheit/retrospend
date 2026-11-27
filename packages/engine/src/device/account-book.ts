import { updateBalance } from "../account-balance-local";
import {
	ACCOUNT_CLOSE_MUTATION,
	ACCOUNT_CREATE_MUTATION,
	ACCOUNT_REOPEN_MUTATION,
	ACCOUNT_SET_RATE_TYPE_MUTATION,
	ACCOUNT_UPDATE_BALANCE_MUTATION,
	ACCOUNT_UPDATE_MUTATION,
} from "../account-mutations";
import { setRateType } from "../account-rate-local";
import { closeAccount, reopenAccount } from "../account-state-local";
import {
	type AccountFieldsInput,
	createAccount,
	updateAccount,
} from "../account-write-local";
import type { TableRows } from "../port";
import type { UndoToken } from "../undo";
import {
	accountWithoutText,
	type TextFreeAccountRow,
	type TextFreeTransferRow,
	transferWithoutText,
} from "../wealth-rows";

// A person's account create, edit, close, reopen, balance update or rate type
// switch, as the device books it: the engine's account mutations over the same
// fields the v1 bodies take, so the device's rows and the server's meet by the
// body's client-made ids. As with recurring writes the booking checks no
// version: which version and balance the server holds is decided at send (the
// body's `expectedVersion` and `expectedBalance`, taken from `accountBase`),
// and a view that has moved on only makes this booking a refusal.
//
// The rows an account write changes are `wealth`, not `changes`: the outbox,
// the overlay and the pull-time compare read `PendingChange`, and teaching
// them these tables is the sender's work (PR6 of slice-device-wealth). Until
// then an account entry is booked and previewed here and is not queued.

export type AccountCreateBody = AccountFieldsInput & { id: string };
export type AccountUpdateBody = AccountFieldsInput & {
	id: string;
	legId: string;
	rateTypeId: string;
};
export interface AccountStateBody {
	id: string;
}
export interface AccountBalanceBody {
	id: string;
	balance: string;
	rateType?: string | null;
	exchangeRate?: string | null;
	legId: string;
	rateTypeId: string;
}
export interface AccountRateTypeBody {
	id: string;
	rateType: string | null;
	/** YYYY-MM-DD the type applies from; today when absent. */
	from?: string | null;
	rateTypeId: string;
}

export type AccountOp =
	| { kind: "accountCreate"; body: AccountCreateBody }
	| { kind: "accountUpdate"; body: AccountUpdateBody }
	| { kind: "accountClose" | "accountReopen"; body: AccountStateBody }
	| { kind: "accountBalance"; body: AccountBalanceBody }
	| { kind: "accountRateType"; body: AccountRateTypeBody };

export const isAccountOp = (op: { kind: string }): op is AccountOp =>
	op.kind.startsWith("account");

/** The mutation of an account write, the figures it moves, and its write over `now`. */
export function accountPlanOf(op: AccountOp, now: Date) {
	switch (op.kind) {
		case "accountCreate":
			return {
				id: ACCOUNT_CREATE_MUTATION.id,
				touches: ACCOUNT_CREATE_MUTATION.touches,
				write: createAccount({ ...op.body, now }),
			};
		case "accountUpdate":
			return {
				id: ACCOUNT_UPDATE_MUTATION.id,
				touches: ACCOUNT_UPDATE_MUTATION.touches,
				write: updateAccount({ ...op.body, now }),
			};
		case "accountClose":
			return {
				id: ACCOUNT_CLOSE_MUTATION.id,
				touches: ACCOUNT_CLOSE_MUTATION.touches,
				write: closeAccount({ id: op.body.id, now }),
			};
		case "accountReopen":
			return {
				id: ACCOUNT_REOPEN_MUTATION.id,
				touches: ACCOUNT_REOPEN_MUTATION.touches,
				write: reopenAccount({ id: op.body.id, now }),
			};
		case "accountBalance": {
			const { id, ...rest } = op.body;
			return {
				id: ACCOUNT_UPDATE_BALANCE_MUTATION.id,
				touches: ACCOUNT_UPDATE_BALANCE_MUTATION.touches,
				write: updateBalance({ ...rest, accountId: id, now }),
			};
		}
		case "accountRateType": {
			const { id, ...rest } = op.body;
			return {
				id: ACCOUNT_SET_RATE_TYPE_MUTATION.id,
				touches: ACCOUNT_SET_RATE_TYPE_MUTATION.touches,
				write: setRateType({ ...rest, accountId: id, now }),
			};
		}
	}
}

/** The tables an account or transfer write changes (a transfer's fee expense is an expense change, not one of these). */
type WealthTable =
	| "accounts"
	| "legs"
	| "snapshots"
	| "rateSwitches"
	| "transfers";

type RowOf<T extends WealthTable> = T extends "accounts"
	? TextFreeAccountRow
	: T extends "transfers"
		? TextFreeTransferRow
		: TableRows[T];

/** One account-family row an entry changed, as the device booked it: an account without its name, a transfer without its note. */
export type WealthChange = {
	[T in WealthTable]: {
		readonly table: T;
		readonly id: string;
		readonly before: RowOf<T> | null;
		readonly after: RowOf<T> | null;
	};
}[WealthTable];

const WEALTH_TABLES: readonly string[] = [
	"accounts",
	"legs",
	"snapshots",
	"rateSwitches",
	"transfers",
] satisfies WealthTable[];

/** The account, leg, snapshot, rate switch and transfer rows a write changed; the account's name and the transfer's note are never kept. */
export function wealthChangesOf(undo: UndoToken): WealthChange[] {
	const rows = undo.kind === "revert" ? undo.changes : [];
	return rows.flatMap((c): WealthChange[] => {
		if (!WEALTH_TABLES.includes(c.table)) return [];
		const bare = (row: unknown) => {
			if (row === null) return row;
			if (c.table === "accounts")
				return accountWithoutText(row as TableRows["accounts"]);
			if (c.table === "transfers")
				return transferWithoutText(row as TableRows["transfers"]);
			return row;
		};
		return [
			{ ...c, before: bare(c.before), after: bare(c.after) } as WealthChange,
		];
	});
}
