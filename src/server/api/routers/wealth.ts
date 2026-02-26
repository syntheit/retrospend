import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { BASE_CURRENCY } from "~/lib/constants";
import { generateCsv } from "~/lib/csv";
import { normalizeDate } from "~/lib/date";
import { toNumberOrNull, toNumberWithDefault } from "~/lib/utils";
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
					rate: toNumberWithDefault(asset.exchangeRate),
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
			const wealthService = new WealthService(db);

			return await wealthService.getDashboardSummary(
				session.user.id,
				targetCurrency,
			);
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

		const rateMap = new Map<string, { rate: number; type: string | null }>();
		for (const currency of currencies) {
			const currencyRates = rates.filter((rate) => rate.currency === currency);
			if (currencyRates.length > 0 && currencyRates[0]) {
				rateMap.set(currency, {
					rate: toNumberWithDefault(currencyRates[0].rate),
					type: currencyRates[0].type,
				});
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
			const rateData = rateMap.get(asset.currency) || { rate: 1, type: null };
			const balance = toNumberWithDefault(asset.balance);
			const balanceInUSD =
				rateData.type === "crypto"
					? balance * rateData.rate
					: balance / rateData.rate;
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

	importAssets: protectedProcedure
		.input(
			z.object({
				rows: z.array(
					z.object({
						name: z.string().min(1),
						type: z.nativeEnum(AssetType),
						currency: z.string().length(3),
						balance: z.number(),
						isLiquid: z.boolean(),
						interestRate: z.number().optional().nullable(),
						minimumPayment: z.number().optional().nullable(),
						dueDate: z.number().int().min(1).max(31).optional().nullable(),
					}),
				),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { db, session } = ctx;
			const today = normalizeDate(new Date());
			const wealthService = new WealthService(db);
			let successCount = 0;
			let errorCount = 0;

			for (const row of input.rows) {
				try {
					// Find existing by name
					const existing = await db.assetAccount.findFirst({
						where: {
							userId: session.user.id,
							name: row.name,
						},
					});

					// Resolve rate
					const { rate, rateType } = await wealthService.resolveExchangeRate(
						row.currency,
						today,
					);

					const balanceInUSD = wealthService.calculateBalanceInUSD(
						row.balance,
						rate,
						row.currency,
					);

					await db.$transaction(async (tx) => {
						let assetId: string;

						if (existing) {
							await tx.assetAccount.update({
								where: { id: existing.id },
								data: {
									type: row.type,
									currency: row.currency,
									balance: row.balance,
									exchangeRate: rate,
									exchangeRateType: rateType,
									isLiquid: row.isLiquid,
									interestRate: row.interestRate,
									minimumPayment: row.minimumPayment,
									dueDate: row.dueDate,
								},
							});
							assetId = existing.id;
						} else {
							const created = await tx.assetAccount.create({
								data: {
									userId: session.user.id,
									name: row.name,
									type: row.type,
									currency: row.currency,
									balance: row.balance,
									exchangeRate: rate,
									exchangeRateType: rateType,
									isLiquid: row.isLiquid,
									interestRate: row.interestRate,
									minimumPayment: row.minimumPayment,
									dueDate: row.dueDate,
								},
							});
							assetId = created.id;
						}

						await wealthService.recordAssetSnapshot(
							tx,
							assetId,
							today,
							row.balance,
							balanceInUSD,
						);
					});

					successCount++;
				} catch (error) {
					console.error(`Failed to import wealth row ${row.name}:`, error);
					errorCount++;
				}
			}

			return { successCount, errorCount };
		}),
});
