/**
 * The rates the Wealth dashboard (wealth.service.ts) values accounts and
 * snapshots with, moved out of getDashboardSummary unchanged. Legacy float
 * rates in the stored convention (fiat per USD, USD per coin); the new
 * figures use accounts/valuation.ts, which follows the same rule in Decimal.
 */
import { isValidRate, USD } from "~/lib/money";
import { toNumberOrNull } from "~/lib/utils";
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
	balance: number;
	balanceInUSD: number;
	date: Date;
	recordedAt: Date;
}

interface RatedAsset {
	currency: string;
	exchangeRateType: string | null;
	exchangeRate: { toString(): string } | null;
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
		stored: number | null,
		date: Date,
	) => {
		if (currency === USD) return 1;
		if (rateType === CUSTOM_RATE_TYPE && isValidRate(stored)) {
			return stored;
		}
		const picked = rateFor(currency, date, rateType);
		if (picked) return picked.rate;
		return isValidRate(stored) ? stored : null;
	};

	/** The rate that values `asset` on `date`, with its own stored rate. */
	const assetRate = (asset: RatedAsset, date: Date) =>
		rateOf(
			asset.currency,
			asset.exchangeRateType,
			toNumberOrNull(asset.exchangeRate),
			date,
		);

	/**
	 * The rate that values a snapshot on `date`. A snapshot taken when the
	 * account had another currency or rate type uses its own, never the
	 * account's current one. A custom rate typed back then only survives
	 * in the recorded USD value, so that case returns null.
	 */
	const snapshotRate = (snap: HeldSnapshot, asset: RatedAsset, date: Date) => {
		if (
			snap.currency === asset.currency &&
			snap.exchangeRateType === asset.exchangeRateType
		) {
			return assetRate(asset, date);
		}
		if (snap.currency === USD) return 1;
		if (snap.exchangeRateType === CUSTOM_RATE_TYPE) return null;
		return rateOf(snap.currency, snap.exchangeRateType, null, date);
	};

	return { rateOf, assetRate, snapshotRate };
}
