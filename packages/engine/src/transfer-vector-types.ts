/** The shapes the transfer vectors are written in. See transfer-vectors.ts for the rules the values are derived from. */

import type { SeedAccount } from "./account-vector-types";
import type { TransferOp } from "./device/transfer-book";
import type { ExpenseSeed } from "./expense-create-conformance";
import type { OnlineReason } from "./transfer-kit";

export interface ExpectedTransfer {
	kind: string;
	date: string;
	fromAccountId: string | null;
	fromAmount: string;
	toAccountId: string | null;
	toAmount: string;
	toCurrency: string;
	feeExpenseId: string | null;
	countedFromUnits: string;
	countedToUnits: string;
	note: string | null;
}

export interface ExpectedTransferLeg {
	accountId: string | null;
	amount: string;
	currency: string;
	homeAmount: string | null;
	homeCurrency: string | null;
	source: string;
	/** The stored day. */
	date: string;
	transferId: string;
	expenseId: string | null;
}

/** The fee's expense as the create books it: the standard OUT row and its booked rate. */
export interface ExpectedFee {
	title: string;
	description: string;
	amount: string;
	currency: string;
	amountInUSD: string;
	exchangeRate: string;
	rateType: string | null;
	homeCurrency: string;
	homeRate: string;
	homeAmount: string;
	/** The instant: the start of the move's day in the saved zone. */
	date: string;
}

export interface ExpectedBalance {
	balance: string;
	countedUnits: string;
}

/** What a step leaves, by the id the vector names. Absent keys are not checked. */
export interface ExpectedTransferState {
	accounts?: Record<string, ExpectedBalance>;
	transfers?: Record<string, ExpectedTransfer>;
	legs?: Record<string, ExpectedTransferLeg>;
	expenses?: Record<string, ExpectedFee>;
	/** Rows that must not exist. */
	gone?: { transfers?: string[]; legs?: string[]; expenses?: string[] };
	/** How many legs there are in all. */
	legCount?: number;
	/** The home net worth minor. */
	netWorth?: number;
}

export type TransferExpect =
	| { done: ExpectedTransferState }
	/** The write is refused in these words and stores nothing. */
	| { refused: string }
	/** The device cannot book it: no rate for these currencies. */
	| { missingRate: string[] }
	/** The server books it; the device refuses with this reason and stores nothing. */
	| { online: OnlineReason };

export interface TransferStep {
	/** The instant the write runs at. */
	now: string;
	op: TransferOp;
	expect: TransferExpect;
}

/** The personal budget book a case starts with: its currency, or none (Just track). */
export type SeedBudget = "none" | { currency: string };

export interface TransferVector {
	name: string;
	seed: ExpenseSeed;
	accounts: SeedAccount[];
	budget: SeedBudget;
	steps: TransferStep[];
}
