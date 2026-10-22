/**
 * Wealth page math, kept pure so it can be tested apart from the UI.
 */
import { toNumber } from "./decimal";

export interface WealthStatsAsset {
	type: string;
	/** Balance in the home currency. */
	balanceInTargetCurrency: number;
	balanceInUSD: number;
	isLiquid: boolean;
	interestRate?: unknown;
}

export function isLiabilityType(type: string): boolean {
	return type.startsWith("LIABILITY_");
}

/**
 * Headline numbers for the wealth page. Callers pass every asset, never a
 * filtered table, so the tiles match the 30-day change and history chart.
 */
export function computeWealthStats(
	assets: readonly WealthStatsAsset[],
	/** Null or missing when there is no history that old. */
	netWorth30DaysAgo?: number | null,
) {
	let totalAssets = 0;
	let totalLiabilities = 0;
	let totalLiquidAssets = 0;
	let weightedAPRSum = 0;
	let totalLiabilityBalanceForAPR = 0;

	for (const asset of assets) {
		const value = asset.balanceInTargetCurrency;
		const usdValue = asset.balanceInUSD;
		const interestRate = toNumber(asset.interestRate);

		if (isLiabilityType(asset.type)) {
			totalLiabilities += value;
			totalLiabilityBalanceForAPR += usdValue;
			if (interestRate && usdValue > 0) {
				weightedAPRSum += interestRate * usdValue;
			}
		} else {
			totalAssets += value;
			if (asset.isLiquid) {
				totalLiquidAssets += value;
			}
		}
	}

	const weightedAPR =
		totalLiabilityBalanceForAPR > 0
			? weightedAPRSum / totalLiabilityBalanceForAPR
			: 0;

	return {
		assets: totalAssets,
		liabilities: totalLiabilities,
		netWorth: totalAssets - totalLiabilities,
		totalLiquidAssets,
		weightedAPR,
		netWorth30DaysAgo: netWorth30DaysAgo ?? null,
	};
}

/**
 * An asset's share of total assets, as a percentage. Null for a liability:
 * it is not part of the assets it would be a share of.
 */
export function allocationPercent(
	asset: Pick<WealthStatsAsset, "type" | "balanceInTargetCurrency">,
	totalAssets: number,
): number | null {
	if (isLiabilityType(asset.type)) return null;
	if (totalAssets <= 0) return 0;
	return (asset.balanceInTargetCurrency / totalAssets) * 100;
}

/**
 * Change in net worth over the period. Null without a baseline: a missing
 * earlier value is not 0.
 */
export function netWorthChange(
	current: number,
	before: number | null | undefined,
): number | null {
	if (before === null || before === undefined) return null;
	return current - before;
}

/**
 * Percent change in net worth over the period. Null when there is no
 * earlier value to compare against (missing or 0): any percent would be
 * made up.
 */
export function netWorthPercentChange(
	current: number,
	before: number | null | undefined,
): number | null {
	if (before === null || before === undefined || before === 0) return null;
	return ((current - before) / Math.abs(before)) * 100;
}
