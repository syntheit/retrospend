/** The shapes the account vectors are written in, and what they share: the rate table, the user and the clock. See account-vectors.ts for the rules the values are derived from. */
import type { AccountOp } from "./device/account-book";
import type { ExpenseSeed } from "./expense-create-conformance";
import { BA, rate, seed } from "./expense-create-vectors";

/** A client-made id as a uuid (v1 takes no other), numbered so a vector reads. */
export const uuid = (n: number) =>
	`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** An account the case starts with, as the server stores it (no legs, no snapshot). */
export interface SeedAccount {
	id: string;
	name: string;
	type: string;
	currency: string;
	balance: string;
	exchangeRate: string | null;
	exchangeRateType: string | null;
	countedUnits?: string;
	closedAt?: Date;
}

export interface ExpectedAccount {
	balance: string;
	exchangeRate: string | null;
	exchangeRateType: string | null;
	countedUnits: string;
	/** An instant, or null for open. */
	closedAt: string | null;
	currency: string;
	version: number;
	name: string;
}

export interface ExpectedLeg {
	accountId: string;
	amount: string;
	homeAmount: string | null;
	homeCurrency: string | null;
	/** The stored day. */
	date: string;
	source: string;
}

export interface ExpectedSnapshot {
	accountId: string;
	day: string;
	balance: string;
	exchangeRateType: string | null;
	/** The instant it was written; a write that changes nothing leaves it. */
	recordedAt?: string;
	/** The USD value; only the server's row keeps it. */
	usd?: string;
}

export interface ExpectedSwitch {
	accountId: string;
	from: string;
	type: string | null;
	previousType: string | null;
}

/** What a step leaves, by the id the vector names. Absent keys are not checked. */
export interface ExpectedState {
	accounts?: Record<string, Partial<ExpectedAccount>>;
	legs?: Record<string, ExpectedLeg>;
	/** How many legs each account has. */
	legCount?: Record<string, number>;
	snapshots?: ExpectedSnapshot[];
	switches?: Record<string, ExpectedSwitch>;
	/** How many rate switches each account has. */
	switchCount?: Record<string, number>;
	/** The home net worth minor. */
	netWorth?: number;
}

export type StepExpect =
	| { done: ExpectedState }
	/** The write is refused in these words and stores nothing. */
	| { refused: string }
	/** The device cannot book it and the server refuses it: no rate for these currencies. */
	| { missingRate: string[] };

export interface AccountStep {
	/** The instant the write runs at. */
	now: string;
	op: AccountOp;
	expect: StepExpect;
}

export interface AccountVector {
	name: string;
	seed: ExpenseSeed;
	accounts?: SeedAccount[];
	steps: AccountStep[];
}

export const RATES = [
	rate("ARS", "blue", "1545", "2026-11-01T00:00:00Z"),
	rate("ARS", "official", "1050", "2026-11-01T00:00:00Z"),
];
export const ARS = seed("ARS", BA, RATES);

export const NOV10 = "2026-11-10T15:00:00Z"; // Buenos Aires Nov 10, 12:00
export const NOV10_LATE = "2026-11-11T02:00:00Z"; // Buenos Aires Nov 10, 23:00; the UTC day is Nov 11
