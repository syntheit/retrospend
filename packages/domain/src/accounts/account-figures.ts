/**
 * The pure half of the account figures (IMPLEMENTATION §2.4): net worth, net
 * worth change with its parts, per-currency balances and Not tracked. The
 * server loads the inputs with SQL (src/server/services/accounts/figures.ts,
 * load.ts); a device loads rows from its own store (netWorthInputsFromRows,
 * accountsLedgerFromRows). Both feed the same compute, and a pg test holds
 * the two loaders to each other digit for digit.
 *
 * A device keeps each account's balance by replaying its legs through
 * applyLegs (apply-legs.ts, the account_leg_apply trigger), so the balance a
 * row carries here is the stored one on both sides. Owed to you and You owe
 * are shared money and stay server-computed: the device gets them as a
 * reading (`OwedReading`) and adds them as given.
 *
 * A missing rate never becomes 1: net worth reports the currencies it needs
 * and no value, and the change is null (R14).
 */
import { toMinor } from "../envelope/units";
import { type Decimal, dec } from "../precise-decimal";
import type { AccountLegSource } from "./apply-legs";
import {
	CHANGE_PARTS,
	type NetWorthChange,
	type NotTrackedHistory,
	netWorthChange,
} from "./net-worth-change";
import { type AssetType, worthOf } from "./places";
import {
	type AccountHistory,
	addDays,
	type LegFacts,
	type RateTypeRow,
} from "./series";
import { homeValue, type RatePick } from "./valuation";

/** The span netWorthChange figures cover, in days, ending today. */
export const CHANGE_DAYS = 30;

export { CHANGE_PARTS };

/** An amount of money in minor units. */
export interface MinorMoney {
	readonly minor: number;
	readonly currency: string;
}

/** The `asset_account` columns the figures read; amounts are decimal strings. */
export interface AccountRow {
	readonly id: string;
	readonly type: AssetType;
	readonly currency: string;
	readonly balance: string;
	/** Units per USD (USD per coin on CRYPTO). */
	readonly exchangeRate: string | null;
	readonly exchangeRateType: string | null;
	readonly closedAt: Date | null;
	readonly createdAt: Date;
}

/** The `asset_snapshot` columns the history reads. */
export interface SnapshotRow {
	readonly accountId: string;
	readonly date: Date;
	readonly recordedAt: Date;
	readonly balance: string;
	readonly currency: string | null;
	readonly exchangeRateType: string | null;
}

/** The `account_leg` columns the figures read. */
export interface LegRow {
	readonly id: string;
	/** Null is Not tracked. */
	readonly accountId: string | null;
	readonly currency: string;
	readonly date: Date;
	readonly createdAt: Date;
	readonly amount: string;
	readonly source: AccountLegSource;
	readonly homeAmount: string | null;
	readonly homeCurrency: string | null;
}

/** The `asset_rate_type` columns: a dated rate type switch. */
export interface RateSwitchRow extends RateTypeRow {
	readonly accountId: string;
	readonly createdAt: Date;
}

/** Owed to you and You owe in the home currency as the server reads them, or the currencies that keep them out. */
export type OwedReading =
	| { readonly owedToYou: number; readonly youOwe: number }
	| { readonly missingRates: readonly string[] };

/** What the net worth compute reads. */
export interface NetWorthInputs {
	readonly home: string;
	/** Every account of the user; closed ones are left out by the compute. */
	readonly accounts: readonly AccountRow[];
	/** Not tracked: units per currency, summed over its legs. */
	readonly notTracked: readonly { currency: string; units: string }[];
	readonly pick: RatePick;
	readonly owed: OwedReading;
}

export interface NetWorthReading {
	/** Null when a rate is missing; `missingRates` names the currencies (unsorted, may repeat). */
	readonly value: MinorMoney | null;
	readonly missingRates: string[];
}

/**
 * Net worth at `now` in the home currency: open accounts each at their rate
 * type, Not tracked at the default pick, plus Owed to you minus You owe (I8).
 */
export function netWorthFrom(
	inputs: NetWorthInputs,
	now: Date,
): NetWorthReading {
	const { home, pick, owed } = inputs;
	let total = dec(0);
	const missing: string[] = [];
	for (const a of inputs.accounts) {
		if (a.closedAt !== null) continue;
		const value = homeValue(
			pick,
			{
				currency: a.currency,
				rateType: a.exchangeRateType,
				storedRate: a.exchangeRate,
			},
			worthOf(a.type, dec(a.balance)),
			home,
			now,
		);
		if (value === null) missing.push(a.currency);
		else total = total.add(value);
	}
	for (const u of inputs.notTracked) {
		const value = homeValue(
			pick,
			{ currency: u.currency, rateType: null, storedRate: null },
			dec(u.units),
			home,
			now,
		);
		if (value === null) missing.push(u.currency);
		else total = total.add(value);
	}
	if ("missingRates" in owed) missing.push(...owed.missingRates);
	if (missing.length || "missingRates" in owed) {
		return { value: null, missingRates: missing };
	}
	return {
		value: {
			minor: toMinor(total, home) + owed.owedToYou - owed.youOwe,
			currency: home,
		},
		missingRates: [],
	};
}

/** Not tracked units per currency from legs held in memory (the SQL loader groups and sums). */
export function notTrackedUnitsOf(
	legs: readonly Pick<LegRow, "accountId" | "currency" | "amount">[],
): { currency: string; units: string }[] {
	const sums = new Map<string, Decimal>();
	for (const leg of legs) {
		if (leg.accountId !== null) continue;
		sums.set(leg.currency, (sums.get(leg.currency) ?? dec(0)).add(leg.amount));
	}
	return [...sums].map(([currency, units]) => ({
		currency,
		units: units.toString(),
	}));
}

/**
 * What open accounts hold per currency, liabilities against you; narrowed to
 * `accountId`, that one account whether it is open or closed.
 */
export function accountBalancesFrom(
	accounts: readonly AccountRow[],
	accountId?: string,
): MinorMoney[] {
	const totals = new Map<string, bigint>();
	for (const a of accounts) {
		if (accountId ? a.id !== accountId : a.closedAt !== null) continue;
		const minor = toMinor(worthOf(a.type, dec(a.balance)), a.currency);
		totals.set(a.currency, (totals.get(a.currency) ?? 0n) + BigInt(minor));
	}
	return [...totals].map(([currency, minor]) => ({
		currency,
		minor: Number(minor),
	}));
}

/** Not tracked per currency in minor units; currencies that net to nothing are left out. */
export function notTrackedFrom(
	units: readonly { currency: string; units: string }[],
): MinorMoney[] {
	return units
		.map((u) => ({ currency: u.currency, minor: toMinor(u.units, u.currency) }))
		.filter((m) => m.minor !== 0);
}

/** What the net worth change reads: every account's history, Not tracked, and the rates. */
export interface AccountsLedger {
	readonly homeCurrency: string;
	readonly histories: readonly AccountHistory[];
	readonly notTracked: readonly NotTrackedHistory[];
	readonly pick: RatePick;
}

const legFacts = (l: LegRow): LegFacts => ({
	id: l.id,
	date: l.date,
	createdAt: l.createdAt,
	amount: dec(l.amount),
	source: l.source,
	homeAmount: l.homeAmount === null ? null : dec(l.homeAmount),
	homeCurrency: l.homeCurrency,
});

function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
	const out = new Map<K, T[]>();
	for (const row of rows) {
		const k = key(row);
		const list = out.get(k) ?? [];
		list.push(row);
		out.set(k, list);
	}
	return out;
}

const time = (a: Date, b: Date) => a.getTime() - b.getTime();

/**
 * The ledger from rows held in memory, in any order: accounts by when they
 * were created, snapshots by date then when recorded, legs by date then when
 * written, rate type switches by day then when written (several can share a
 * day). Both loaders go through here, so the order is one rule.
 */
export function accountsLedgerFromRows(args: {
	home: string;
	accounts: readonly AccountRow[];
	snapshots: readonly SnapshotRow[];
	legs: readonly LegRow[];
	rateSwitches: readonly RateSwitchRow[];
	pick: RatePick;
}): AccountsLedger {
	const accounts = [...args.accounts].sort(
		(a, b) => time(a.createdAt, b.createdAt) || (a.id < b.id ? -1 : 1),
	);
	const snapshotsOf = groupBy(
		[...args.snapshots].sort(
			(a, b) => time(a.date, b.date) || time(a.recordedAt, b.recordedAt),
		),
		(s) => s.accountId,
	);
	const sortedLegs = [...args.legs].sort(
		(a, b) => time(a.date, b.date) || time(a.createdAt, b.createdAt),
	);
	const legsOf = groupBy(sortedLegs, (l) => l.accountId);
	const switchesOf = groupBy(
		[...args.rateSwitches].sort(
			(a, b) => time(a.from, b.from) || time(a.createdAt, b.createdAt),
		),
		(r) => r.accountId,
	);

	const histories: AccountHistory[] = accounts.map((a) => ({
		account: {
			id: a.id,
			type: a.type,
			currency: a.currency,
			exchangeRateType: a.exchangeRateType,
			exchangeRate: a.exchangeRate === null ? null : dec(a.exchangeRate),
			closedAt: a.closedAt,
		},
		checkpoints: (snapshotsOf.get(a.id) ?? []).map((s) => ({
			date: s.date,
			recordedAt: s.recordedAt,
			balance: dec(s.balance),
			currency: s.currency,
			exchangeRateType: s.exchangeRateType,
		})),
		legs: (legsOf.get(a.id) ?? []).map(legFacts),
		rateTypes: (switchesOf.get(a.id) ?? []).map((r) => ({
			from: r.from,
			type: r.type,
			previousType: r.previousType,
		})),
	}));
	const notTracked = [
		...groupBy(legsOf.get(null) ?? [], (l) => l.currency),
	].map(([currency, rows]) => ({ currency, legs: rows.map(legFacts) }));
	return { homeCurrency: args.home, histories, notTracked, pick: args.pick };
}

/** The net worth inputs from rows held in memory: what a device loader returns. */
export function netWorthInputsFromRows(args: {
	home: string;
	accounts: readonly AccountRow[];
	legs: readonly LegRow[];
	pick: RatePick;
	owed: OwedReading;
}): NetWorthInputs {
	return {
		home: args.home,
		accounts: args.accounts,
		notTracked: notTrackedUnitsOf(args.legs),
		pick: args.pick,
		owed: args.owed,
	};
}

/**
 * The breakdown of the last `days` days, ending today (the UTC day, as
 * Wealth's history). A move is dated in the user's zone, which can be a day
 * ahead of UTC, so the span ends a day later: no move dated today is ever
 * left out. Null when a rate is missing.
 */
export function netWorthChangeFrom(
	ledger: AccountsLedger,
	now: Date,
	days = CHANGE_DAYS,
): NetWorthChange | null {
	const today = now.toISOString().slice(0, 10);
	return netWorthChange(
		ledger.histories,
		ledger.notTracked,
		{ from: addDays(today, -days), to: addDays(today, 1) },
		ledger.homeCurrency,
		ledger.pick,
	);
}
