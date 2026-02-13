import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { BASE_CURRENCY } from "~/lib/constants";
import { generateCsv } from "~/lib/csv";
import { normalizeDate } from "~/lib/date";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { WealthService } from "~/server/services/wealth.service";
import { AssetType } from "~prisma";

export const wealthRouter = createTRPCRouter({
	createAsset: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1),
				type: z.nativeEnum(AssetType),
				currency: z.string().length(3),
				balance: z.number(),
				exchangeRate: z.number().optional(),
				exchangeRateType: z.string().optional(),
				isLiquid: z.boolean().default(false),
				interestRate: z.number().optional(),
				minimumPayment: z.number().optional(),
				dueDate: z.number().int().min(1).max(31).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { db, session } = ctx;
			const today = normalizeDate(new Date());
			const wealthService = new WealthService(db);

			// Resolve exchange rate using service
			const { rate, rateType } = await wealthService.resolveExchangeRate(
				input.currency,
				today,
				input.exchangeRate && input.exchangeRateType
					? { rate: input.exchangeRate, type: input.exchangeRateType }
					: undefined,
			);

			// Calculate balance in USD with sanity check
			const balanceInUSD = wealthService.calculateBalanceInUSD(
				input.balance,
				rate,
				input.currency,
			);

			// Create asset and record snapshot in transaction
			const result = await db.$transaction(async (tx) => {
				const account = await tx.assetAccount.create({
					data: {
						userId: session.user.id,
						name: input.name,
						type: input.type,
						currency: input.currency,
						balance: input.balance,
						exchangeRate: rate,
						exchangeRateType: rateType,
						isLiquid: input.isLiquid,
						interestRate: input.interestRate,
						minimumPayment: input.minimumPayment,
						dueDate: input.dueDate,
					},
				});

				// Record snapshot and history
				await wealthService.recordAssetSnapshot(
					tx,
					account.id,
					today,
					input.balance,
					balanceInUSD,
				);

				return account;
			});

			return result;
		}),

	updateAssetBalance: protectedProcedure
		.input(
			z.object({
				assetId: z.string().cuid(),
				newBalance: z.number(),
				exchangeRate: z.number().optional(),
				exchangeRateType: z.string().optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { db, session } = ctx;
			const today = normalizeDate(new Date());
			const wealthService = new WealthService(db);

			// Verify asset ownership
			const asset = await db.assetAccount.findFirst({
				where: {
					id: input.assetId,
					userId: session.user.id,
				},
			});

			if (!asset) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Asset not found" });
			}

			// Resolve exchange rate (prioritize user input, then stored rate, then fetch)
			let resolvedRate: { rate: number; rateType: string | null };

			if (input.exchangeRate && input.exchangeRateType) {
				// User provided rate
				resolvedRate = {
					rate: input.exchangeRate,
					rateType: input.exchangeRateType,
				};
			} else if (asset.exchangeRate) {
				// Use stored rate
				resolvedRate = {
					rate: asset.exchangeRate.toNumber(),
					rateType: asset.exchangeRateType,
				};
			} else {
				// Fetch new rate
				resolvedRate = await wealthService.resolveExchangeRate(
					asset.currency,
					today,
				);
			}

			// Calculate balance in USD with sanity check
			const balanceInUSD = wealthService.calculateBalanceInUSD(
				input.newBalance,
				resolvedRate.rate,
				asset.currency,
			);

			// Update asset and record snapshot in transaction
			const result = await db.$transaction(async (tx) => {
				const updatedAsset = await tx.assetAccount.update({
					where: { id: input.assetId },
					data: {
						balance: input.newBalance,
						exchangeRate: resolvedRate.rate,
						exchangeRateType: resolvedRate.rateType,
					},
				});

				// Record snapshot and history
				await wealthService.recordAssetSnapshot(
					tx,
					input.assetId,
					today,
					input.newBalance,
					balanceInUSD,
				);

				return updatedAsset;
			});

			return result;
		}),

	updateAsset: protectedProcedure
		.input(
			z.object({
				id: z.string().cuid(),
				name: z.string().min(1),
				type: z.nativeEnum(AssetType),
				currency: z.string().length(3),
				balance: z.number(),
				exchangeRate: z.number().optional(),
				exchangeRateType: z.string().optional(),
				isLiquid: z.boolean().default(false),
				interestRate: z.number().optional(),
				minimumPayment: z.number().optional(),
				dueDate: z.number().int().min(1).max(31).optional(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { db, session } = ctx;
			const today = normalizeDate(new Date());
			const wealthService = new WealthService(db);

			// Verify asset ownership
			const existingAsset = await db.assetAccount.findFirst({
				where: {
					id: input.id,
					userId: session.user.id,
				},
			});

			if (!existingAsset) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Asset not found" });
			}

			// Resolve exchange rate using service
			const { rate, rateType } = await wealthService.resolveExchangeRate(
				input.currency,
				today,
				input.exchangeRate && input.exchangeRateType
					? { rate: input.exchangeRate, type: input.exchangeRateType }
					: undefined,
			);

			// Calculate balance in USD with sanity check
			const balanceInUSD = wealthService.calculateBalanceInUSD(
				input.balance,
				rate,
				input.currency,
			);

			// Update asset and record snapshot in transaction
			const result = await db.$transaction(async (tx) => {
				const updatedAsset = await tx.assetAccount.update({
					where: { id: input.id },
					data: {
						name: input.name,
						type: input.type,
						currency: input.currency,
						balance: input.balance,
						exchangeRate: rate,
						exchangeRateType: rateType,
						isLiquid: input.isLiquid,
						interestRate: input.interestRate,
						minimumPayment: input.minimumPayment,
						dueDate: input.dueDate,
					},
				});

				// Record snapshot and history
				await wealthService.recordAssetSnapshot(
					tx,
					input.id,
					today,
					input.balance,
					balanceInUSD,
				);

				return updatedAsset;
			});

			return result;
		}),

	getDashboard: protectedProcedure
		.input(z.object({ currency: z.string().length(3).optional() }).optional())
		.query(async ({ ctx, input }) => {
			const { db, session } = ctx;
			const today = normalizeDate(new Date());
			const targetCurrency = input?.currency ?? BASE_CURRENCY;

			const assets = await db.assetAccount.findMany({
				where: { userId: session.user.id },
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
			const currencies = [...new Set([...assets.map((a) => a.currency), targetCurrency])];

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
				ratesMap.set(r.currency, r.rate.toNumber());
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
					rate = asset.exchangeRate?.toNumber() ?? null;
				}
				const effectiveRate = rate || 1;
				const balanceInUSD = asset.balance.toNumber() / effectiveRate;

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
					balance: asset.balance.toNumber(),
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
					account: { userId: session.user.id },
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
						select: { accountId: true, balanceInUSD: true },
					}),
				),
			);

			const currentBalancesUSD = new Map<string, number>();
			for (const asset of assets) {
				const initial = initialPoints.find((p) => p?.accountId === asset.id);
				currentBalancesUSD.set(asset.id, initial?.balanceInUSD.toNumber() ?? 0);
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

			const history: { date: string; amount: number; assets: number; liabilities: number }[] = [];
			const sortedDates = [...snapshotsByDate.keys()].sort();

			for (const dateStr of sortedDates) {
				const daysSnapshots = snapshotsByDate.get(dateStr);
				if (!daysSnapshots) continue;

				daysSnapshots.forEach((snap) => {
					currentBalancesUSD.set(snap.accountId, snap.balanceInUSD.toNumber());
				});

				let assetsInTarget = 0;
				let liabilitiesInTarget = 0;
				for (const [assetId, balUSD] of currentBalancesUSD.entries()) {
					const asset = assetMap.get(assetId);
					if (!asset) continue;

					const isLiability = asset.type.startsWith("LIABILITY_");
					// Same-currency awareness to prevent Billion Dollar bug
					const latestSnapToday = daysSnapshots.find((s) => s.accountId === assetId);
					const value = (asset.currency === targetCurrency && latestSnapToday)
						? latestSnapToday.balance.toNumber()
						: balUSD * targetRate;

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
			if (history.length === 0 || history[history.length - 1]?.date !== todayStr) {
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
		}),
	deleteAsset: protectedProcedure
		.input(
			z.object({
				id: z.string().cuid(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { db, session } = ctx;

			const result = await db.assetAccount.deleteMany({
				where: {
					id: input.id,
					userId: session.user.id,
				},
			});

			if (result.count === 0) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Asset not found",
				});
			}

			return { success: true };
		}),

	exportCsv: protectedProcedure.mutation(async ({ ctx }) => {
		const { db, session } = ctx;

		const assets = await db.assetAccount.findMany({
			where: {
				userId: session.user.id,
			},
			orderBy: {
				createdAt: "asc",
			},
		});

		const currencies = [...new Set(assets.map((asset) => asset.currency))];
		const rates = await db.exchangeRate.findMany({
			where: {
				currency: {
					in: currencies,
				},
			},
			orderBy: {
				date: "desc",
			},
		});

		const rateMap = new Map<string, number>();
		for (const currency of currencies) {
			const currencyRates = rates.filter((rate) => rate.currency === currency);
			if (currencyRates.length > 0 && currencyRates[0]?.rate) {
				rateMap.set(currency, currencyRates[0].rate.toNumber());
			}
		}

		const header = [
			"name",
			"type",
			"currency",
			"balance",
			"balanceInUSD",
			"exchangeRate",
			"exchangeRateType",
			"isLiquid",
			"createdAt",
			"updatedAt",
		];

		const rows = assets.map((asset) => {
			const rate = rateMap.get(asset.currency) || 1;
			const balanceInUSD = asset.balance.toNumber() / rate;
			return [
				asset.name,
				asset.type,
				asset.currency,
				asset.balance,
				balanceInUSD,
				asset.exchangeRate,
				asset.exchangeRateType,
				asset.isLiquid,
				asset.createdAt,
				asset.updatedAt,
			];
		});

		return { csv: generateCsv(header, rows) };
	}),
});
