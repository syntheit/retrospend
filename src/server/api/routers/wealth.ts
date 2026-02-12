import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { BASE_CURRENCY } from "~/lib/constants";
import { generateCsv } from "~/lib/csv";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { AssetType } from "~prisma";
import { getBestExchangeRate } from "./shared-currency";

// Helper to normalize date to midnight UTC to match exchange rate and snapshot dates
const normalizeDate = (date: Date) => {
	const d = new Date(date);
	d.setUTCHours(0, 0, 0, 0);
	return d;
};

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

			let rate = 1;
			let rateType = null;
			if (input.currency !== BASE_CURRENCY) {
				if (input.exchangeRate && input.exchangeRateType) {
					// Use provided exchange rate
					rate = input.exchangeRate;
					rateType = input.exchangeRateType;
				} else {
					// Fetch exchange rate automatically using prioritized logic
					const bestRate = await getBestExchangeRate(db, input.currency, today);

					if (bestRate) {
						rate = bestRate;
						rateType = "official";
					} else {
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: `No exchange rate found for ${input.currency}. Please sync rates or provide a custom rate.`,
						});
					}
				}
			}

			const balanceInUSD = input.balance / rate;

			// Sanity check to prevent "Billion Dollar" bug (multiplying instead of dividing)
			if (
				input.currency !== BASE_CURRENCY &&
				rate > 1 &&
				balanceInUSD > input.balance
			) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message:
						"Exchange rate calculation sanity check failed. Please contact support.",
				});
			}

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

				await tx.assetSnapshot.create({
					data: {
						accountId: account.id,
						date: today,
						balance: input.balance,
						balanceInUSD: balanceInUSD,
					},
				});

				await tx.assetHistory.create({
					data: {
						assetId: account.id,
						balance: input.balance,
					},
				});

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

			const asset = await db.assetAccount.findFirst({
				where: {
					id: input.assetId,
					userId: session.user.id,
				},
			});

			if (!asset) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Asset not found" });
			}

			let rate = 1;
			let rateType = asset.exchangeRateType;
			if (asset.currency !== BASE_CURRENCY) {
				if (input.exchangeRate && input.exchangeRateType) {
					// Use provided exchange rate
					rate = input.exchangeRate;
					rateType = input.exchangeRateType;
				} else {
					if (asset.exchangeRate) {
						rate = asset.exchangeRate.toNumber();
					} else {
						// Fetch exchange rate automatically using prioritized logic
						const bestRate = await getBestExchangeRate(
							db,
							asset.currency,
							today,
						);

						if (bestRate) {
							rate = bestRate;
							rateType = "official";
						} else {
							throw new TRPCError({
								code: "BAD_REQUEST",
								message: `No exchange rate found for ${asset.currency}. Please sync rates or provide a custom rate.`,
							});
						}
					}
				}
			}

			const balanceInUSD = input.newBalance / rate;

			// Sanity check to prevent "Billion Dollar" bug
			if (
				asset.currency !== BASE_CURRENCY &&
				rate > 1 &&
				balanceInUSD > input.newBalance
			) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message:
						"Exchange rate calculation sanity check failed. Please contact support.",
				});
			}

			const result = await db.$transaction(async (tx) => {
				const updatedAsset = await tx.assetAccount.update({
					where: { id: input.assetId },
					data: {
						balance: input.newBalance,
						exchangeRate: rate,
						exchangeRateType: rateType,
					},
				});

				await tx.assetSnapshot.upsert({
					where: {
						accountId_date: {
							accountId: input.assetId,
							date: today,
						},
					},
					update: {
						balance: input.newBalance,
						balanceInUSD: balanceInUSD,
					},
					create: {
						accountId: input.assetId,
						date: today,
						balance: input.newBalance,
						balanceInUSD: balanceInUSD,
					},
				});

				await tx.assetHistory.create({
					data: {
						assetId: input.assetId,
						balance: input.newBalance,
					},
				});

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

			const existingAsset = await db.assetAccount.findFirst({
				where: {
					id: input.id,
					userId: session.user.id,
				},
			});

			if (!existingAsset) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Asset not found" });
			}

			let rate = 1;
			let rateType = null;
			if (input.currency !== BASE_CURRENCY) {
				if (input.exchangeRate && input.exchangeRateType) {
					// Use provided exchange rate
					rate = input.exchangeRate;
					rateType = input.exchangeRateType;
				} else {
					// Fetch exchange rate automatically using prioritized logic
					const bestRate = await getBestExchangeRate(db, input.currency, today);

					if (bestRate) {
						rate = bestRate;
						rateType = "official";
					} else {
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: `No exchange rate found for ${input.currency}. Please sync rates or provide a custom rate.`,
						});
					}
				}
			}

			const balanceInUSD = input.balance / rate;

			// Sanity check to prevent "Billion Dollar" bug
			if (
				input.currency !== BASE_CURRENCY &&
				rate > 1 &&
				balanceInUSD > input.balance
			) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message:
						"Exchange rate calculation sanity check failed. Please contact support.",
				});
			}

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

				await tx.assetSnapshot.upsert({
					where: {
						accountId_date: {
							accountId: input.id,
							date: today,
						},
					},
					update: {
						balance: input.balance,
						balanceInUSD: balanceInUSD,
					},
					create: {
						accountId: input.id,
						date: today,
						balance: input.balance,
						balanceInUSD: balanceInUSD,
					},
				});

				await tx.assetHistory.create({
					data: {
						assetId: input.id,
						balance: input.balance,
					},
				});

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

			const targetRate =
				(await getBestExchangeRate(db, targetCurrency, today)) ?? 1;

			const currencies = [...new Set(assets.map((a) => a.currency))];
			const rates = new Map<string, number>();
			rates.set(BASE_CURRENCY, 1);

			for (const currency of currencies) {
				if (currency === BASE_CURRENCY) continue;
				const rate = await getBestExchangeRate(db, currency, today);
				if (rate) {
					rates.set(currency, rate);
				}
			}

			let totalNetWorthUSD = 0;
			let totalAssetsUSD = 0;
			let totalLiabilitiesUSD = 0;
			let totalLiquidAssetsUSD = 0;
			let weightedAPR = 0;
			let totalLiabilityBalanceUSD = 0;

			const assetsWithUSD = assets.map((asset) => {
				// Prioritize live rate, then stored rate, then default 1 only if USD
				let rate: number | null = rates.get(asset.currency) ?? null;
				if (!rate) {
					rate = asset.exchangeRate?.toNumber() ?? null;
				}
				if (!rate && asset.currency === BASE_CURRENCY) {
					rate = 1;
				}

				// If we still don't have a rate for a non-USD currency,
				// we must not default to 1 as it would cause massive balance spikes.
				const effectiveRate = rate || 1;
				const balanceInUSD = asset.balance.toNumber() / effectiveRate;

				// Check if this is a liability (negative balance)
				const isLiability = asset.type.startsWith("LIABILITY_");
				const adjustedBalanceInUSD = isLiability ? -balanceInUSD : balanceInUSD;

				totalNetWorthUSD += adjustedBalanceInUSD;

				if (isLiability) {
					totalLiabilitiesUSD += balanceInUSD; // Store as positive for liabilities
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

			const snapshots = await db.assetSnapshot.findMany({
				where: {
					account: { userId: session.user.id },
					date: { gte: oneYearAgo },
				},
				orderBy: { date: "asc" },
				include: {
					account: {
						select: { id: true, currency: true },
					},
				},
			});

			const currentBalancesUSD = new Map<string, number>();
			const initialSnapshots = await Promise.all(
				assets.map((asset) =>
					db.assetSnapshot.findFirst({
						where: {
							accountId: asset.id,
							date: { lt: oneYearAgo },
						},
						orderBy: { date: "desc" },
					}),
				),
			);

			initialSnapshots.forEach((snap, index) => {
				const asset = assets[index];
				if (asset && snap) {
					const balanceInUSD = snap.balanceInUSD.toNumber();
					currentBalancesUSD.set(asset.id, balanceInUSD);
				} else if (asset) {
					currentBalancesUSD.set(asset.id, 0);
				}
			});

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

			const history: { date: string; amount: number }[] = [];
			const sortedDates = [...snapshotsByDate.keys()].sort();

			for (const dateStr of sortedDates) {
				const daysSnapshots = snapshotsByDate.get(dateStr);
				if (!daysSnapshots) continue;

				daysSnapshots.forEach((snap) => {
					const balanceInUSD = snap.balanceInUSD.toNumber();
					currentBalancesUSD.set(snap.accountId, balanceInUSD);
				});

				let totalInTarget = 0;
				for (const [assetId, balUSD] of currentBalancesUSD.entries()) {
					const asset = assets.find((a) => a.id === assetId);
					// Principle: Same-currency = original amount (if snapshot exists for this day)
					// This fixes the Billion Dollar bug for users viewing in their home currency.
					const latestSnap = daysSnapshots?.find(
						(s) => s.accountId === assetId,
					);

					if (asset?.currency === targetCurrency && latestSnap) {
						totalInTarget += latestSnap.balance.toNumber();
					} else {
						totalInTarget += balUSD * targetRate;
					}
				}

				history.push({ date: dateStr, amount: totalInTarget });
			}

			const todayStr = today.toISOString().split("T")[0] ?? "";
			if (
				history.length === 0 ||
				history[history.length - 1]?.date !== todayStr
			) {
				history.push({ date: todayStr, amount: totalNetWorthUSD * targetRate });
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
