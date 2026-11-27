/**
 * The account writes as device money mutations, for the preview runner and
 * the Undo sheet: each is the write function LocalDb runs (so a preview is
 * the write), with the figures it can change. The lists are the server's
 * (accounts/mutations.ts FIGURES, update-balance BALANCE_FIGURES,
 * rate-type RATE_TYPE_FIGURES); src/server/services/__tests__/
 * account-conformance.pg.test.ts holds each equal to its server mutation.
 */
import { ACCOUNT_UPDATE_BALANCE, updateBalance } from "./account-balance-local";
import { ACCOUNT_SET_RATE_TYPE, setRateType } from "./account-rate-local";
import {
	ACCOUNT_CLOSE,
	ACCOUNT_REOPEN,
	closeAccount,
	reopenAccount,
} from "./account-state-local";
import {
	ACCOUNT_CREATE,
	ACCOUNT_UPDATE,
	createAccount,
	updateAccount,
} from "./account-write-local";
import { deviceMutation } from "./preview";

/** Account create, edit, close and reopen: net worth, the account's own balance and what moved into or out of the totals. */
export const ACCOUNT_FIGURES = [
	"netWorth",
	"accounts.balance",
	"netWorthChange.opened",
	"netWorthChange.closed",
	"netWorthChange.revaluation",
] as const;

/** Update balance: the Not logged difference and any revaluation of a rate switch. */
export const BALANCE_FIGURES = [
	"netWorth",
	"accounts.balance",
	"netWorthChange.notLogged",
	"netWorthChange.revaluation",
] as const;

/** A rate type switch. */
export const RATE_TYPE_FIGURES = [
	"netWorth",
	"netWorthChange.revaluation",
	"accounts.balance",
] as const;

export const ACCOUNT_CREATE_MUTATION = deviceMutation({
	id: ACCOUNT_CREATE,
	touches: ACCOUNT_FIGURES,
	write: createAccount,
});

export const ACCOUNT_UPDATE_MUTATION = deviceMutation({
	id: ACCOUNT_UPDATE,
	touches: ACCOUNT_FIGURES,
	write: updateAccount,
});

export const ACCOUNT_CLOSE_MUTATION = deviceMutation({
	id: ACCOUNT_CLOSE,
	touches: ACCOUNT_FIGURES,
	write: closeAccount,
});

export const ACCOUNT_REOPEN_MUTATION = deviceMutation({
	id: ACCOUNT_REOPEN,
	touches: ACCOUNT_FIGURES,
	write: reopenAccount,
});

export const ACCOUNT_UPDATE_BALANCE_MUTATION = deviceMutation({
	id: ACCOUNT_UPDATE_BALANCE,
	touches: BALANCE_FIGURES,
	write: updateBalance,
});

export const ACCOUNT_SET_RATE_TYPE_MUTATION = deviceMutation({
	id: ACCOUNT_SET_RATE_TYPE,
	touches: RATE_TYPE_FIGURES,
	write: setRateType,
});
