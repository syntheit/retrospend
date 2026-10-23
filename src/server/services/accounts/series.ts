/**
 * An account's balance and value on any day (MONEY-MOVES §2.1, middle
 * option N75). Pure: the caller loads the rows.
 *
 * Balance on day d = the last balance update (snapshot) on or before d,
 * plus every leg dated on or before d that the update does not already
 * include: legs dated after it, and legs written after it (a move recorded
 * late still counts from its own date). A balance update's own leg is the
 * record of its Not logged difference and never adds on top of it.
 *
 * Rate type on day d (D3): the last dated switch on or before d; before any
 * switch, the type the update recorded (today's Wealth rule), else the
 * account's.
 */
import type { Decimal } from "@prisma/client/runtime/index-browser";
import { dec } from "~/server/services/envelope/units";
import type { AccountLegSource, AssetType } from "~prisma";
import { balanceEffect, worthOf } from "./places";
import { homeValue, type RatePick } from "./valuation";

export interface AccountFacts {
	readonly id: string;
	readonly type: AssetType;
	readonly currency: string;
	readonly exchangeRateType: string | null;
	readonly exchangeRate: Decimal | null;
	readonly closedAt: Date | null;
}

export interface CheckpointRow {
	readonly date: Date;
	readonly recordedAt: Date;
	readonly balance: Decimal;
	/** Null on rows older than the snapshot meta columns: the account's own then. */
	readonly currency: string | null;
	readonly exchangeRateType: string | null;
}

export interface LegFacts {
	readonly id: string;
	readonly date: Date;
	readonly createdAt: Date;
	/** Signed in what you have, in the account's currency. */
	readonly amount: Decimal;
	readonly source: AccountLegSource;
	readonly homeAmount: Decimal | null;
	readonly homeCurrency: string | null;
}

export interface RateTypeRow {
	readonly from: Date;
	readonly type: string | null;
	/** The type before this switch; on the first one, the type before any. */
	readonly previousType: string | null;
}

export interface AccountHistory {
	readonly account: AccountFacts;
	/** Ascending by date. */
	readonly checkpoints: readonly CheckpointRow[];
	readonly legs: readonly LegFacts[];
	/** Ascending by `from`, then by when each was written (several can share a day). */
	readonly rateTypes: readonly RateTypeRow[];
}

/** YYYY-MM-DD of a stored calendar day (UTC midnight). */
export const dayOf = (date: Date) => date.toISOString().slice(0, 10);

/** The end of a day, so rates published that day count for it (as Wealth does). */
export const endOfDay = (day: string) => new Date(`${day}T23:59:59.999Z`);

export function addDays(day: string, n: number): string {
	return dayOf(
		new Date(new Date(`${day}T00:00:00.000Z`).getTime() + n * 86_400_000),
	);
}

function lastCheckpointOn(
	history: AccountHistory,
	day: string,
): CheckpointRow | null {
	let found: CheckpointRow | null = null;
	for (const c of history.checkpoints) {
		if (dayOf(c.date) <= day) found = c;
	}
	return found;
}

/** Whether `base` already includes `leg` (it was written after the leg, on a later or the same day). */
const includedIn = (base: CheckpointRow, leg: LegFacts) =>
	dayOf(leg.date) <= dayOf(base.date) && leg.createdAt <= base.recordedAt;

/**
 * The stored balance on `day`, in the account's currency, as it reads before
 * `asOf` (default: now). Null when the account had no balance yet.
 */
export function storedOn(
	history: AccountHistory,
	day: string,
	asOf?: Date,
): Decimal | null {
	const known = asOf
		? {
				...history,
				checkpoints: history.checkpoints.filter((c) => c.recordedAt < asOf),
			}
		: history;
	const base = lastCheckpointOn(known, day);
	let balance = base ? base.balance : null;
	for (const leg of history.legs) {
		if (leg.source === "BALANCE_UPDATE" || dayOf(leg.date) > day) continue;
		if (asOf && leg.createdAt >= asOf) continue;
		if (base && includedIn(base, leg)) continue;
		balance = (balance ?? dec(0)).add(
			balanceEffect(history.account.type, leg.amount),
		);
	}
	return balance;
}

/** The rate type and stored rate an account is valued at on `day`. */
export function typeOn(
	history: AccountHistory,
	day: string,
): { rateType: string | null; storedRate: Decimal | null } {
	const { account } = history;
	let switched: RateTypeRow | null = null;
	for (const row of history.rateTypes) {
		if (dayOf(row.from) <= day) switched = row;
	}
	if (switched) {
		return { rateType: switched.type, storedRate: account.exchangeRate };
	}
	// Before the first switch: the type it replaced, not today's.
	const first = history.rateTypes[0];
	if (first) {
		return { rateType: first.previousType, storedRate: account.exchangeRate };
	}
	const base = lastCheckpointOn(history, day);
	const recorded = base?.currency
		? base.exchangeRateType
		: account.exchangeRateType;
	return { rateType: recorded, storedRate: account.exchangeRate };
}

/** Whether the account is closed on `day`: it counts 0 from the day it closed. */
export const closedOn = (account: AccountFacts, day: string) =>
	account.closedAt !== null && day >= dayOf(account.closedAt);

/** What `stored` (a balance of this account) is worth in the home currency on `day`; null when a rate is missing. */
export function homeOfStored(
	history: AccountHistory,
	stored: Decimal,
	day: string,
	homeCurrency: string,
	pick: RatePick,
): Decimal | null {
	const { rateType, storedRate } = typeOn(history, day);
	return homeValue(
		pick,
		{ currency: history.account.currency, rateType, storedRate },
		worthOf(history.account.type, stored),
		homeCurrency,
		endOfDay(day),
	);
}

/** The account's value in the home currency on `day` (0 before it existed and once closed); null when a rate is missing. */
export function valueOn(
	history: AccountHistory,
	day: string,
	homeCurrency: string,
	pick: RatePick,
): Decimal | null {
	if (closedOn(history.account, day)) return dec(0);
	const stored = storedOn(history, day);
	if (stored === null) return dec(0);
	return homeOfStored(history, stored, day, homeCurrency, pick);
}
