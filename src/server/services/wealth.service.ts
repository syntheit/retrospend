import { TRPCError } from "@trpc/server";
import { BASE_CURRENCY } from "~/lib/constants";
import { normalizeDate } from "~/lib/date";
import { fromUSD, isValidRate, toUSD, USD } from "~/lib/money";
import { toNumberOrNull, toNumberWithDefault } from "~/lib/utils";
import type { Prisma, PrismaClient } from "~prisma";
import {
	findExchangeRate,
	findExchangeRatesForDates,
} from "../exchange-rates";

/** Rate type of a rate the user typed in; it is kept as is, never looked up. */
export const CUSTOM_RATE_TYPE = "custom";

/** End of a snapshot's UTC day, so rates published that day count for it. */
function endOfSnapshotDay(dateStr: string): Date {
	return new Date(`${dateStr}T23:59:59.999Z`);
}

/**
 * WealthService - Encapsulates business logic for wealth/asset management
 *
 * Asset rates follow the money convention (~/lib/money). An asset keeps the
 * rate type it was saved with (blue, official, ...) and every valuation looks
 * that type up in the rate table for the date being valued. Only a custom
 * rate (type "custom") is used as typed.
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
	calculateBalanceInUSD(balance: number, rate: number, currency: string): number {
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
	 */
	async recordAssetSnapshot(
		tx: Prisma.TransactionClient,
		assetId: string,
		date: Date,
		balance: number,
		balanceInUSD: number,
		userId: string,
	): Promise<void> {
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
			},
			create: {
				accountId: assetId,
				userId,
				date,
				balance,
				balanceInUSD,
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

		const assets = await db.assetAccount.findMany({
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
				createdAt: true,
				updatedAt: true,
			},
		});

		const assetMap = new Map(assets.map((a) => [a.id, a]));

		// One rate query per currency; per-date picks happen in memory.
		const rateFor = await findExchangeRatesForDates(db, [
			...assets.map((a) => a.currency),
			targetCurrency,
		]);

		/**
		 * The rate that values `asset` on `date`: its custom rate, else the
		 * table rate of its own type, else the rate stored on the asset when
		 * its currency has no table rate at all. Null when there is none.
		 */
		const assetRate = (asset: (typeof assets)[number], date: Date) => {
			if (asset.currency === USD) return 1;
			const stored = toNumberOrNull(asset.exchangeRate);
			if (asset.exchangeRateType === CUSTOM_RATE_TYPE && isValidRate(stored)) {
				return stored;
			}
			const picked = rateFor(asset.currency, date, asset.exchangeRateType);
			if (picked) return picked.rate;
			return isValidRate(stored) ? stored : null;
		};
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
					balance,
					balanceInUSD: 0,
					balanceInTargetCurrency: 0,
					rateMissing: true,
				};
			}

			const balanceInUSD = toUSD(balance, asset.currency, rate);

			if (asset.type.startsWith("LIABILITY_")) {
				totalLiabilityBalanceUSD += balanceInUSD;
				if (asset.interestRate && balanceInUSD > 0) {
					weightedAPR += asset.interestRate * balanceInUSD;
				}
			}

			return {
				...asset,
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

		const oneYearAgo = new Date(today);
		oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

		// History reconstruction optimization
		const snapshots = await db.assetSnapshot.findMany({
			where: {
				account: { userId: userId },
				date: { gte: oneYearAgo },
			},
			orderBy: { date: "asc" },
		});

		// Fetch latest initial point before one year ago for each asset
		const initialPoints = await Promise.all(
			assets.map((a) =>
				db.assetSnapshot.findFirst({
					where: { accountId: a.id, date: { lt: oneYearAgo } },
					orderBy: { date: "desc" },
					select: { accountId: true, balanceInUSD: true, balance: true },
				}),
			),
		);

		const currentBalancesUSD = new Map<string, number>();
		const currentBalancesNative = new Map<string, number>();
		for (const asset of assets) {
			const initial = initialPoints.find((p) => p?.accountId === asset.id);
			currentBalancesUSD.set(
				asset.id,
				toNumberWithDefault(initial?.balanceInUSD),
			);
			currentBalancesNative.set(
				asset.id,
				toNumberWithDefault(initial?.balance),
			);
		}

		const snapshotsByDate = new Map<string, typeof snapshots>();
		snapshots.forEach((s) => {
			const dateStr = s.date?.toISOString().split("T")[0];
			if (!dateStr) return;
			const existing = snapshotsByDate.get(dateStr);
			if (!existing) {
				snapshotsByDate.set(dateStr, [s]);
			} else {
				existing.push(s);
			}
		});

		const history: {
			date: string;
			amount: number;
			assets: number;
			liabilities: number;
		}[] = [];
		const sortedDates = [...snapshotsByDate.keys()].sort();

		for (const dateStr of sortedDates) {
			const daysSnapshots = snapshotsByDate.get(dateStr);
			if (!daysSnapshots) continue;

			daysSnapshots.forEach((snap) => {
				currentBalancesUSD.set(
					snap.accountId,
					toNumberWithDefault(snap.balanceInUSD),
				);
				currentBalancesNative.set(
					snap.accountId,
					toNumberWithDefault(snap.balance),
				);
			});

			// Every value on this date uses the rates for this date, both the
			// asset's own and the target currency's.
			const day = endOfSnapshotDay(dateStr);
			const dayTargetRate = targetRateAt(day);

			let assetsInTarget = 0;
			let liabilitiesInTarget = 0;

			for (const [assetId, balNative] of currentBalancesNative.entries()) {
				const asset = assetMap.get(assetId);
				if (!asset) continue;

				const rate = assetRate(asset, day);
				// No rate for the asset: the USD value recorded with the snapshot.
				const balInUSD =
					rate === null
						? (currentBalancesUSD.get(assetId) ?? 0)
						: toUSD(balNative, asset.currency, rate);

				const value =
					asset.currency === targetCurrency && rate !== null
						? balNative
						: fromUSD(balInUSD, targetCurrency, dayTargetRate);

				if (asset.type.startsWith("LIABILITY_")) {
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
		};
	}
}
