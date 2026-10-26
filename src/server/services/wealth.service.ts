import { TRPCError } from "@trpc/server";
import { BASE_CURRENCY } from "~/lib/constants";
import { normalizeDate } from "~/lib/date";
import { fromUSD, isValidRate, toUSD, USD } from "@retrospend/domain/money";
import { toNumberOrNull, toNumberWithDefault } from "~/lib/utils";
import type { AssetType, Prisma, PrismaClient } from "~prisma";
import { findExchangeRate, findExchangeRatesForDates } from "../exchange-rates";
import { loadDashboardLegs } from "./accounts/dashboard-legs";
import {
	dashboardRates,
	type HeldSnapshot,
	type SnapshotMeta,
	usdWithoutRate,
} from "./accounts/dashboard-rates";

import { CUSTOM_RATE_TYPE } from "./accounts/valuation";

export type { SnapshotMeta };
/** Rate type of a rate the user typed in; it is kept as is, never looked up. */
export { CUSTOM_RATE_TYPE };

/** UTC day of a date, as YYYY-MM-DD. */
function dayString(date: Date): string {
	return date.toISOString().slice(0, 10);
}

/** End of a snapshot's UTC day, so rates published that day count for it. */
function endOfSnapshotDay(dateStr: string): Date {
	return new Date(`${dateStr}T23:59:59.999Z`);
}

/**
 * WealthService - Encapsulates business logic for wealth/asset management
 *
 * Asset rates follow the money convention (@retrospend/domain/money). An asset keeps the
 * rate type it was saved with (blue, official, ...) and every valuation looks
 * that type up in the rate table for the date being valued. Only a custom
 * rate (type "custom") is used as typed.
 *
 * A closed account (closedAt set) is out of today's totals and counts 0 in
 * the history from the day it was closed, but its earlier snapshots still
 * count, so closing an account never rewrites past net worth.
 */
export class WealthService {
	constructor(private db: PrismaClient | Prisma.TransactionClient) {}

	/**
	 * Resolves the exchange rate to store on an asset.
	 *
	 * 1. USD: 1.
	 * 2. A custom rate typed by the user: used as is.
	 * 3. Otherwise the table rate for the date, preferring the requested type.
	 * 4. No rate at all: BAD_REQUEST, never 1.
	 */
	async resolveExchangeRate(
		currency: string,
		date: Date,
		requested?: { rate?: number | null; type?: string | null },
	): Promise<{ rate: number; rateType: string | null }> {
		if (currency === BASE_CURRENCY) {
			return { rate: 1, rateType: null };
		}

		if (requested?.type === CUSTOM_RATE_TYPE && isValidRate(requested.rate)) {
			return { rate: requested.rate, rateType: CUSTOM_RATE_TYPE };
		}

		const bestRate = await findExchangeRate(
			this.db,
			currency,
			date,
			requested?.type,
		);
		if (bestRate) {
			return { rate: bestRate.rate, rateType: bestRate.type };
		}

		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `No exchange rate found for ${currency}. Please sync rates or provide a custom rate.`,
		});
	}

	/** Balance in USD (unrounded). Negative balances convert like any other. */
	calculateBalanceInUSD(
		balance: number,
		rate: number,
		currency: string,
	): number {
		if (currency !== USD && !isValidRate(rate)) {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: `Invalid exchange rate: ${rate}. Rate must be positive.`,
			});
		}
		return toUSD(balance, currency, rate);
	}

	/**
	 * Records an asset snapshot and history entry within a transaction.
	 *
	 * This method must be called within a Prisma transaction context.
	 * It creates/updates the daily snapshot and appends to the history log.
	 * The snapshot keeps the account's currency, type and rate type, so a
	 * later edit of the account does not revalue it.
	 */
	async recordAssetSnapshot(
		tx: Prisma.TransactionClient,
		assetId: string,
		date: Date,
		balance: number,
		balanceInUSD: number,
		userId: string,
		meta: SnapshotMeta,
	): Promise<void> {
		// recordedAt orders this balance against legs of the same day (accounts/series.ts).
		const snapshotMeta = {
			currency: meta.currency,
			type: meta.type,
			exchangeRateType: meta.exchangeRateType ?? null,
			recordedAt: new Date(),
		};

		// Upsert snapshot (one per asset per day)
		await tx.assetSnapshot.upsert({
			where: {
				accountId_date: {
					accountId: assetId,
					date,
				},
			},
			update: {
				balance,
				balanceInUSD,
				...snapshotMeta,
			},
			create: {
				accountId: assetId,
				userId,
				date,
				balance,
				balanceInUSD,
				...snapshotMeta,
			},
		});

		// Append to history (unlimited entries)
		await tx.assetHistory.create({
			data: {
				assetId,
				userId,
				balance,
			},
		});
	}

	async getDashboardSummary(userId: string, targetCurrency: string) {
		const db = this.db as PrismaClient;
		const today = normalizeDate(new Date());
		const now = new Date();

		// Closed accounts are loaded too: they are out of today's totals but
		// keep their past in the history.
		const allAssets = await db.assetAccount.findMany({
			where: { userId: userId },
			select: {
				id: true,
				name: true,
				type: true,
				currency: true,
				balance: true,
				exchangeRate: true,
				exchangeRateType: true,
				isLiquid: true,
				interestRate: true,
				closedAt: true,
				createdAt: true,
				updatedAt: true,
			},
		});

		const assets = allAssets.filter((a) => !a.closedAt);
		const closedAssets = allAssets.flatMap((a) =>
			a.closedAt ? [{ ...a, closedAt: a.closedAt }] : [],
		);
		const assetMap = new Map(allAssets.map((a) => [a.id, a]));
		/** Day (YYYY-MM-DD) from which a closed account counts 0. */
		const closedFrom = new Map(
			closedAssets.map((a) => [a.id, dayString(a.closedAt)]),
		);

		const oneYearAgo = new Date(today);
		oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
		const oneYearAgoStr = dayString(oneYearAgo);

		// History reconstruction optimization
		const snapshots = await db.assetSnapshot.findMany({
			where: {
				account: { userId: userId },
				date: { gte: oneYearAgo },
			},
			orderBy: { date: "asc" },
		});
		const legs = await loadDashboardLegs(db, userId, oneYearAgo);

		// Latest point before one year ago for each account that still counts
		// in that window (an account closed before it never shows).
		const initialPoints = await Promise.all(
			allAssets
				.filter((a) => (closedFrom.get(a.id) ?? "9999-12-31") > oneYearAgoStr)
				.map((a) =>
					db.assetSnapshot.findFirst({
						where: { accountId: a.id, date: { lt: oneYearAgo } },
						orderBy: { date: "desc" },
						select: {
							accountId: true,
							balanceInUSD: true,
							balance: true,
							currency: true,
							type: true,
							exchangeRateType: true,
							date: true,
							recordedAt: true,
						},
					}),
				),
		);

		// One rate query per currency; per-date picks happen in memory.
		const rateFor = await findExchangeRatesForDates(db, [
			...allAssets.map((a) => a.currency),
			...snapshots.flatMap((s) => (s.currency ? [s.currency] : [])),
			...initialPoints.flatMap((p) => (p?.currency ? [p.currency] : [])),
			targetCurrency,
		]);

		const { rateOf, assetRate, snapshotRate } = dashboardRates(rateFor);

		const targetRateAt = (date: Date) =>
			rateFor(targetCurrency, date)?.rate ?? null;

		const targetRate = targetRateAt(now);
		const convertToTarget = (usdVal: number) =>
			fromUSD(usdVal, targetCurrency, targetRate);

		let weightedAPR = 0;
		let totalLiabilityBalanceUSD = 0;
		const missingRateCurrencies = new Set<string>();

		const assetsWithUSD = assets.map((asset) => {
			const balance = toNumberWithDefault(asset.balance);
			const rate = assetRate(asset, now);

			if (rate === null) {
				// Left out of every total and reported, never valued at 1:1.
				console.warn(
					`[WealthDashboard] No exchange rate for ${asset.currency}; asset ${asset.id} left out of totals`,
				);
				missingRateCurrencies.add(asset.currency);
				return {
					...asset,
					interestRate: toNumberOrNull(asset.interestRate),
					balance,
					balanceInUSD: 0,
					balanceInTargetCurrency: 0,
					rateMissing: true,
				};
			}

			const balanceInUSD = toUSD(balance, asset.currency, rate);

			if (asset.type.startsWith("LIABILITY_")) {
				totalLiabilityBalanceUSD += balanceInUSD;
				const apr = toNumberOrNull(asset.interestRate);
				if (apr && balanceInUSD > 0) weightedAPR += apr * balanceInUSD;
			}

			return {
				...asset,
				interestRate: toNumberOrNull(asset.interestRate),
				balance,
				balanceInUSD,
				balanceInTargetCurrency:
					asset.currency === targetCurrency
						? balance
						: convertToTarget(balanceInUSD),
				rateMissing: false,
			};
		});

		if (totalLiabilityBalanceUSD > 0) {
			weightedAPR = weightedAPR / totalLiabilityBalanceUSD;
		}

		/** Each account's latest snapshot so far, as it was recorded. */
		const held = new Map<string, HeldSnapshot>();
		const hold = (snap: {
			accountId: string;
			balance: unknown;
			balanceInUSD: unknown;
			currency: string | null;
			type: AssetType | null;
			exchangeRateType: string | null;
			date: Date;
			recordedAt: Date;
		}) => {
			const asset = assetMap.get(snap.accountId);
			if (!asset) return;
			// Rows older than the snapshot columns fall back to the account.
			const recorded = Boolean(snap.currency);
			held.set(snap.accountId, {
				balance: toNumberWithDefault(snap.balance),
				balanceInUSD: toNumberWithDefault(snap.balanceInUSD),
				currency: snap.currency ?? asset.currency,
				type: snap.type ?? asset.type,
				exchangeRateType: recorded
					? snap.exchangeRateType
					: asset.exchangeRateType,
				date: snap.date,
				recordedAt: snap.recordedAt,
			});
		};
		for (const initial of initialPoints) {
			if (initial) hold(initial);
		}

		const snapshotsByDate = new Map<string, typeof snapshots>();
		for (const s of snapshots) {
			const dateStr = dayString(s.date);
			snapshotsByDate.set(dateStr, [
				...(snapshotsByDate.get(dateStr) ?? []),
				s,
			]);
		}

		const history: {
			date: string;
			amount: number;
			assets: number;
			liabilities: number;
		}[] = [];
		// Days with a money move get a point too (accounts/dashboard-legs.ts).
		const sortedDates = [
			...new Set([...snapshotsByDate.keys(), ...legs.days]),
		].sort();

		for (const dateStr of sortedDates) {
			snapshotsByDate.get(dateStr)?.forEach(hold);

			// Every value on this date uses the rates for this date, both the
			// asset's own and the target currency's.
			const day = endOfSnapshotDay(dateStr);
			const dayTargetRate = targetRateAt(day);

			let assetsInTarget = 0;
			let liabilitiesInTarget = 0;

			for (const [assetId, snap] of held.entries()) {
				const asset = assetMap.get(assetId);
				if (!asset) continue;

				// A closed account counts 0 from the day it was closed.
				const closedDay = closedFrom.get(assetId);
				if (closedDay && dateStr >= closedDay) continue;

				// A dated rate type switch (D3) wins over the snapshot's own type.
				const switched = legs.typeOn(assetId, dateStr);
				const rate =
					switched === undefined
						? snapshotRate(snap, asset, day)
						: rateOf(
								snap.currency,
								switched,
								toNumberOrNull(asset.exchangeRate),
								day,
							);
				const balance =
					snap.balance + legs.onTop(assetId, snap.type, snap, dateStr);
				// No rate for the asset: the recorded USD value, with the legs on top.
				let balInUSD: number;
				if (rate !== null) balInUSD = toUSD(balance, snap.currency, rate);
				else {
					const usd = usdWithoutRate(
						snap,
						balance,
						toNumberOrNull(asset.exchangeRate),
					);
					if (usd === null) missingRateCurrencies.add(snap.currency);
					balInUSD = usd ?? snap.balanceInUSD;
				}

				const value =
					snap.currency === targetCurrency && rate !== null
						? balance
						: fromUSD(balInUSD, targetCurrency, dayTargetRate);

				if (snap.type.startsWith("LIABILITY_")) {
					liabilitiesInTarget += value;
				} else {
					assetsInTarget += value;
				}
			}

			history.push({
				date: dateStr,
				amount: assetsInTarget - liabilitiesInTarget,
				assets: assetsInTarget,
				liabilities: liabilitiesInTarget,
			});
		}

		const sumTarget = (pick: (a: (typeof assetsWithUSD)[number]) => boolean) =>
			assetsWithUSD
				.filter((a) => !a.rateMissing && pick(a))
				.reduce((total, a) => total + a.balanceInTargetCurrency, 0);
		const totalAssets = sumTarget((a) => !a.type.startsWith("LIABILITY_"));
		const totalLiabilities = sumTarget((a) => a.type.startsWith("LIABILITY_"));
		const totalLiquidAssets = sumTarget(
			(a) => !a.type.startsWith("LIABILITY_") && a.isLiquid,
		);
		const totalNetWorth = totalAssets - totalLiabilities;

		const todayStr = today.toISOString().split("T")[0] ?? "";
		const lastEntry = history[history.length - 1];
		if (lastEntry?.date === todayStr) {
			// Today's point matches the headline numbers
			Object.assign(lastEntry, {
				amount: totalNetWorth,
				assets: totalAssets,
				liabilities: totalLiabilities,
			});
		} else {
			history.push({
				date: todayStr,
				amount: totalNetWorth,
				assets: totalAssets,
				liabilities: totalLiabilities,
			});
		}

		const thirtyDaysAgo = new Date(today);
		thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
		const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split("T")[0] ?? "";

		const entry30DaysAgo = history
			.filter((h) => h.date <= thirtyDaysAgoStr)
			.slice(-1)[0];

		// Null when there is no history that old: no baseline, so no change to
		// show (0 would make the whole net worth look like a 30-day gain).
		const netWorth30DaysAgo: number | null = entry30DaysAgo?.amount ?? null;

		return {
			totalNetWorth,
			totalAssets,
			totalLiabilities,
			totalLiquidAssets,
			weightedAPR,
			assets: assetsWithUSD,
			history,
			currency: targetCurrency,
			netWorth30DaysAgo,
			/** Currencies with no rate at all; their assets are left out of totals. */
			missingRateCurrencies: [...missingRateCurrencies],
			/** Closed accounts: out of every total, still part of the history. */
			closedAssets: closedAssets.map((a) => ({
				id: a.id,
				name: a.name,
				type: a.type,
				currency: a.currency,
				balance: toNumberWithDefault(a.balance),
				closedAt: a.closedAt,
			})),
		};
	}
}
