/**
 * The rates the Wealth dashboard (wealth.service.ts) values accounts and
 * snapshots with, in the stored convention (fiat per USD, USD per coin) as
 * exact Decimals; the new figures use accounts/valuation.ts, which follows
 * the same rule. A rate that is missing, zero or negative is null, never 1.
 */
import { toUSDDec, USD } from "@retrospend/domain/money-dec";
import {
	type Decimal,
	type DecimalInput,
	dec,
} from "@retrospend/domain/precise-decimal";
import type { AssetType } from "~prisma";
import { CUSTOM_RATE_TYPE, type RatePick } from "./valuation";

/** What an account was when a snapshot of it was taken. */
export interface SnapshotMeta {
	currency: string;
	type: AssetType;
	exchangeRateType: string | null;
}

/** An account's latest snapshot while history is rebuilt, as recorded. */
export interface HeldSnapshot extends SnapshotMeta {
	balance: Decimal;
	balanceInUSD: Decimal;
	date: Date;
	recordedAt: Date;
}

/** UTC day of a date, as YYYY-MM-DD. */
export function dayString(date: Date): string {
	return date.toISOString().slice(0, 10);
}

/** End of a snapshot's UTC day, so rates published that day count for it. */
export function endOfSnapshotDay(dateStr: string): Date {
	return new Date(`${dateStr}T23:59:59.999Z`);
}

/** An asset_snapshot row as the history reads it. */
export interface SnapshotRow {
	accountId: string;
	balance: DecimalInput | null;
	balanceInUSD: DecimalInput | null;
	currency: string | null;
	type: AssetType | null;
	exchangeRateType: string | null;
	date: Date;
	recordedAt: Date;
}

/** A snapshot as recorded; rows older than the snapshot columns fall back to the account. */
export function heldSnapshot(
	snap: SnapshotRow,
	asset: SnapshotMeta,
): HeldSnapshot {
	return {
		balance: dec(snap.balance ?? 0),
		balanceInUSD: dec(snap.balanceInUSD ?? 0),
		currency: snap.currency ?? asset.currency,
		type: snap.type ?? asset.type,
		exchangeRateType: snap.currency
			? snap.exchangeRateType
			: asset.exchangeRateType,
		date: snap.date,
		recordedAt: snap.recordedAt,
	};
}

interface RatedAsset {
	currency: string;
	exchangeRateType: string | null;
	exchangeRate: DecimalInput | null;
}

/** A stored rate as a Decimal when it is finite and above zero, else null. */
export function usableRate(
	rate: DecimalInput | null | undefined,
): Decimal | null {
	if (rate === null || rate === undefined) return null;
	const r = dec(rate);
	return r.isFinite() && r.gt(0) ? r : null;
}

export function dashboardRates(rateFor: RatePick) {
	/**
	 * The rate for `currency` on `date`: a custom rate as stored, else the
	 * table rate of the rate type, else the stored rate when the currency
	 * has no table rate at all. Null when there is none.
	 */
	const rateOf = (
		currency: string,
		rateType: string | null,
		stored: DecimalInput | null,
		date: Date,
	): Decimal | null => {
		if (currency === USD) return dec(1);
		const own = usableRate(stored);
		if (rateType === CUSTOM_RATE_TYPE && own) return own;
		const picked = rateFor(currency, date, rateType);
		if (picked) return dec(picked.rate);
		return own;
	};

	/** The rate that values `asset` on `date`, with its own stored rate. */
	const assetRate = (asset: RatedAsset, date: Date) =>
		rateOf(asset.currency, asset.exchangeRateType, asset.exchangeRate, date);

	/**
	 * The rate that values a snapshot on `date`. A snapshot taken when the
	 * account had another currency or rate type uses its own, never the
	 * account's current one. A custom rate typed back then only survives
	 * in the recorded USD value, so that case returns null.
	 */
	const snapshotRate = (
		snap: HeldSnapshot,
		asset: RatedAsset,
		date: Date,
	): Decimal | null => {
		if (
			snap.currency === asset.currency &&
			snap.exchangeRateType === asset.exchangeRateType
		) {
			return assetRate(asset, date);
		}
		if (snap.currency === USD) return dec(1);
		if (snap.exchangeRateType === CUSTOM_RATE_TYPE) return null;
		return rateOf(snap.currency, snap.exchangeRateType, null, date);
	};

	return { rateOf, assetRate, snapshotRate };
}

/**
 * The USD value of a snapshot's account with no rate, at `balance` (the
 * snapshot plus the legs on top of it). The legs count: the recorded USD
 * value scaled by the balance, else the account's stored rate. Null when
 * nothing values the legs; the caller keeps the recorded value and reports
 * the currency as missing a rate.
 */
export function usdWithoutRate(
	snap: HeldSnapshot,
	balance: Decimal,
	storedRate: DecimalInput | null,
): Decimal | null {
	if (balance.eq(snap.balance)) return snap.balanceInUSD;
	if (!snap.balance.isZero()) {
		return snap.balanceInUSD.mul(balance).div(snap.balance);
	}
	const stored = usableRate(storedRate);
	return stored ? toUSDDec(balance, snap.currency, stored) : null;
}
