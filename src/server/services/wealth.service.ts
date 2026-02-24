import { TRPCError } from "@trpc/server";
import { BASE_CURRENCY } from "~/lib/constants";
import { normalizeDate } from "~/lib/date";
import { toNumberOrNull, toNumberWithDefault } from "~/lib/utils";
import type { Prisma, PrismaClient } from "~prisma";
import { getBestExchangeRate } from "../api/routers/shared-currency";

/**
 * WealthService - Encapsulates business logic for wealth/asset management
 *
 * Extracted from wealth.ts router to eliminate ~120 lines of duplication
 * across createAsset, updateAssetBalance, and updateAsset mutations.
 */
export class WealthService {
	constructor(private db: PrismaClient | Prisma.TransactionClient) {}

	/**
	 * Resolves the exchange rate for a given currency and date.
	 *
	 * Priority:
	 * 1. User-provided rate (if both rate and type are supplied)
	 * 2. Best available rate from database (getBestExchangeRate)
	 * 3. Throws error if no rate found for non-base currency
	 *
	 * @returns { rate: number, rateType: string | null }
	 */
	async resolveExchangeRate(
		currency: string,
		date: Date,
		userProvidedRate?: { rate: number; type: string },
	): Promise<{ rate: number; rateType: string | null }> {
		// Base currency always has rate of 1
		if (currency === BASE_CURRENCY) {
			return { rate: 1, rateType: null };
		}

		// Use user-provided rate if available
		if (userProvidedRate?.rate && userProvidedRate?.type) {
			return { rate: userProvidedRate.rate, rateType: userProvidedRate.type };
		}

		// Fetch exchange rate automatically using prioritized logic
		const bestRate = await getBestExchangeRate(
			this.db as PrismaClient,
			currency,
			date,
		);

		if (bestRate) {
			return { rate: bestRate, rateType: "official" };
		}

		// No rate found - throw error
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: `No exchange rate found for ${currency}. Please sync rates or provide a custom rate.`,
		});
	}

	/**
	 * Calculates balance in USD with "Billion Dollar" sanity check.
	 *
	 * The sanity check prevents a common bug where developers multiply
	 * instead of divide when converting to USD. If rate > 1 and the
	 * USD balance is somehow larger than the original balance, we know
	 * something went wrong.
	 *
	 * @throws TRPCError if sanity check fails
	 */
	calculateBalanceInUSD(
		balance: number,
		rate: number,
		currency: string,
	): number {
		if (rate <= 0) {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: `Invalid exchange rate: ${rate}. Rate must be positive.`,
			});
		}

		let effectiveRate = rate;

		// AUTO-INVERSION DETECTION
		// For many weak currencies (like ARS, BRL, CLP, PYG), the rate is > 1 (Units per USD).
		// If we see a rate like 0.000699 for ARS, it's almost certainly inverted (1/1430).
		// We detect this by seeing if dividing by the rate would make the USD balance
		// significantly LARGER than the native balance for a non-USD currency.
		// NOTE: This only applies to currencies we know are weaker than USD.
		const isStrongCurrency = [
			"GBP",
			"EUR",
			"KWD",
			"BHD",
			"OMR",
			"JOD",
		].includes(currency);

		if (
			currency !== BASE_CURRENCY &&
			!isStrongCurrency &&
			effectiveRate < 0.1
		) {
			// If rate is very small for a weak currency, it's likely inverted.
			// 0.0007 for ARS -> 1428
			effectiveRate = 1 / effectiveRate;
		}

		const balanceInUSD = balance / effectiveRate;

		// Sanity check to prevent "Billion Dollar" bug (multiplying instead of dividing)
		// If the resulting USD balance is more than 50% LARGER than the native balance,
		// and it's not a strong currency, something is wrong.
		if (
			currency !== BASE_CURRENCY &&
			!isStrongCurrency &&
			balanceInUSD > balance * 1.5
		) {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: `Exchange rate calculation sanity check failed for ${currency}. Resulting USD balance ($${balanceInUSD.toLocaleString()}) is nonsensical relative to native balance (${balance.toLocaleString()}). The rate (${rate}) might be inverted or incorrect.`,
			});
		}

		return balanceInUSD;
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
				date,
				balance,
				balanceInUSD,
			},
		});

		// Append to history (unlimited entries)
		await tx.assetHistory.create({
			data: {
				assetId,
				balance,
			},
		});
	}
	async getDashboardSummary(userId: string, targetCurrency: string) {
		const db = this.db as PrismaClient;
		const today = normalizeDate(new Date());

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
		const currencies = [
			...new Set([...assets.map((a) => a.currency), targetCurrency]),
		];

		// BATCH FETCH EXCHANGE RATES (O(1) lookups)
		const allRates = await db.exchangeRate.findMany({
			where: {
				currency: { in: currencies },
				date: { lte: today },
			},
			orderBy: [{ date: "desc" }, { type: "asc" }],
		});

		const ratesMap = new Map<string, number>();
		ratesMap.set(BASE_CURRENCY, 1);
		const finalizedCurrencies = new Set<string>();

		for (const r of allRates) {
			if (finalizedCurrencies.has(r.currency)) continue;
			// Sorting combined with early exit ensures best rate (date desc, type asc)
			ratesMap.set(r.currency, toNumberWithDefault(r.rate));
			finalizedCurrencies.add(r.currency);
		}

		// Validate and log missing rates
		for (const currency of currencies) {
			if (currency === BASE_CURRENCY) continue;
			if (!ratesMap.has(currency)) {
				console.warn(
					`[WealthDashboard] Missing exchange rate for ${currency} on or before ${today.toISOString()}. Defaulting to 1.`,
				);
				ratesMap.set(currency, 1);
			}
		}

		const targetRate = ratesMap.get(targetCurrency) ?? 1;

		let totalNetWorthUSD = 0;
		let totalAssetsUSD = 0;
		let totalLiabilitiesUSD = 0;
		let totalLiquidAssetsUSD = 0;
		let weightedAPR = 0;
		let totalLiabilityBalanceUSD = 0;

		const assetsWithUSD = assets.map((asset) => {
			let rate = ratesMap.get(asset.currency) ?? null;
			if (!rate) {
				// Fallback to stored rate if live rate missing
				rate = toNumberOrNull(asset.exchangeRate);
			}
			const effectiveRate = rate || 1;

			let balanceInUSD = 0;
			try {
				balanceInUSD = this.calculateBalanceInUSD(
					toNumberWithDefault(asset.balance),
					effectiveRate,
					asset.currency,
				);
			} catch (e) {
				console.error(
					`[WealthDashboard] Error calculating balance for ${asset.name}:`,
					e,
				);
				// Last resort fallback to raw division if service fails (though service is better)
				balanceInUSD = toNumberWithDefault(asset.balance) / effectiveRate;
			}

			const isLiability = asset.type.startsWith("LIABILITY_");
			const adjustedBalanceInUSD = isLiability ? -balanceInUSD : balanceInUSD;

			totalNetWorthUSD += adjustedBalanceInUSD;

			if (isLiability) {
				totalLiabilitiesUSD += balanceInUSD;
				totalLiabilityBalanceUSD += balanceInUSD;
				if (asset.interestRate && balanceInUSD > 0) {
					weightedAPR += asset.interestRate * balanceInUSD;
				}
			} else {
				totalAssetsUSD += balanceInUSD;
				if (asset.isLiquid) {
					totalLiquidAssetsUSD += balanceInUSD;
				}
			}

			return {
				...asset,
				balance: toNumberWithDefault(asset.balance),
				balanceInUSD,
				balanceInTargetCurrency: balanceInUSD * targetRate,
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

		// Organize rates for historical lookup
		// Map<Currency, Array<{ date: string, type: string, rate: number }>>
		const historicalRates = new Map<
			string,
			{ date: string; type: string; rate: number }[]
		>();
		const sortedRatesAsc = [...allRates].sort(
			(a, b) => a.date.getTime() - b.date.getTime(),
		);

		for (const r of sortedRatesAsc) {
			const list = historicalRates.get(r.currency) || [];
			list.push({
				date: r.date.toISOString().split("T")[0] || "",
				type: r.type,
				rate: toNumberWithDefault(r.rate),
			});
			historicalRates.set(r.currency, list);
		}

		const getHistoricalRate = (
			currency: string,
			targetType: string | null,
			dateStr: string,
		): number | null => {
			if (currency === BASE_CURRENCY) return 1;
			const rates = historicalRates.get(currency);
			if (!rates || rates.length === 0) return null;

			const candidateRates = rates.filter((r) => r.date <= dateStr);
			if (candidateRates.length === 0) return null;

			// Get the subset of rates for the LATEST available date
			const lastDate = candidateRates[candidateRates.length - 1]?.date;
			const ratesOnDate = candidateRates.filter((r) => r.date === lastDate);

			if (targetType) {
				const match = ratesOnDate.find((r) => r.type === targetType);
				if (match) return match.rate;
			}

			// Fallback logic "Blue" > "Official" > Any
			const blue = ratesOnDate.find((r) => r.type === "blue");
			if (blue) return blue.rate;

			const official = ratesOnDate.find((r) => r.type === "official");
			if (official) return official.rate;

			return ratesOnDate[0]?.rate ?? null;
		};

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

			let assetsInTarget = 0;
			let liabilitiesInTarget = 0;

			for (const [assetId, balNative] of currentBalancesNative.entries()) {
				const asset = assetMap.get(assetId);
				if (!asset) continue;

				// Try to recalculate USD/Target value using historical rate
				let histRate = getHistoricalRate(
					asset.currency,
					asset.exchangeRateType,
					dateStr,
				);

				// Fallback to earliest available rate if history is missing for this currency
				if (!histRate) {
					const rates = historicalRates.get(asset.currency);
					if (rates && rates.length > 0) {
						// rates are sorted by date (earliest first) in the historicalRates map
						histRate = rates[0]?.rate ?? null;
					}
				}

				let balInUSD = 0;
				if (histRate) {
					try {
						balInUSD = this.calculateBalanceInUSD(
							balNative,
							histRate,
							asset.currency,
						);
					} catch (_e) {
						// If service throws (sanity check failed), it means the rate is likely garbage
						// Fallback to snapshot but with extreme suspicion
						balInUSD = currentBalancesUSD.get(assetId) ?? 0;
					}
				} else {
					// Fallback to snapshot's stored USD value (last resort)
					balInUSD = currentBalancesUSD.get(assetId) ?? 0;
				}

				// FINAL SANITY CHECK for historical data points
				// If a single day's balance in USD is > $500M and native balance is much smaller,
				// it's almost certainly a "Billion Dollar bug" snapshot. We skip this asset for this date.
				const isStrongCurrency = [
					"GBP",
					"EUR",
					"KWD",
					"BHD",
					"OMR",
					"JOD",
				].includes(asset.currency);
				if (
					!isStrongCurrency &&
					asset.currency !== BASE_CURRENCY &&
					balInUSD > 500_000_000 &&
					balInUSD > balNative * 10
				) {
					console.warn(
						`[WealthDashboard] Ignoring suspicious historical data point for asset ${asset.id} on ${dateStr}: USD ${balInUSD}`,
					);
					balInUSD = 0;
				}

				const isLiability = asset.type.startsWith("LIABILITY_");
				const value = balInUSD * targetRate;

				if (isLiability) {
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

		const todayStr = today.toISOString().split("T")[0] ?? "";
		if (
			history.length === 0 ||
			history[history.length - 1]?.date !== todayStr
		) {
			history.push({
				date: todayStr,
				amount: totalNetWorthUSD * targetRate,
				assets: totalAssetsUSD * targetRate,
				liabilities: totalLiabilitiesUSD * targetRate,
			});
		}

		return {
			totalNetWorth: totalNetWorthUSD * targetRate,
			totalAssets: totalAssetsUSD * targetRate,
			totalLiabilities: totalLiabilitiesUSD * targetRate,
			totalLiquidAssets: totalLiquidAssetsUSD * targetRate,
			weightedAPR,
			assets: assetsWithUSD,
			history,
			currency: targetCurrency,
		};
	}
}
