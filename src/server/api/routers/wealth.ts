import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { BASE_CURRENCY } from "~/lib/constants";
import { generateCsv } from "~/lib/csv";
import { normalizeDate } from "~/lib/date";
import { isValidRate, sumIn, toUSD } from "~/lib/money";
import { addMonthsClamped } from "~/lib/recurring";
import { toNumberOrNull } from "~/lib/utils";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { findExchangeRate } from "~/server/exchange-rates";
import { getExcludedProjectIds } from "~/server/services/shared-expense-integration";
import { getSpendingItems, spendingWhere } from "~/server/services/spending";
import { WealthService } from "~/server/services/wealth.service";
import { AssetType } from "~prisma";

export const wealthRouter = createTRPCRouter({
	createAsset: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1).max(191),
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
				{ rate: input.exchangeRate, type: input.exchangeRateType },
			);

			// Calculate balance in USD with sanity check
			const balanceInUSD = wealthService.calculateBalanceInUSD(
				input.balance,
				rate,
				input.currency,
			);

			// Create asset and record snapshot in transaction
			const result = await db.$transaction(async (tx) => {
				await tx.$executeRaw`SELECT set_config('app.current_user_id', ${session.user.id}, true),
				                             set_config('role', 'retrospend_app', true)`;
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
					session.user.id,
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

			// Today's rate of the asset's own type (or a newly picked one); a
			// custom rate stays until the user changes it.
			const resolvedRate = await wealthService.resolveExchangeRate(
				asset.currency,
				today,
				input.exchangeRateType
					? { rate: input.exchangeRate, type: input.exchangeRateType }
					: {
							rate: toNumberOrNull(asset.exchangeRate),
							type: asset.exchangeRateType,
						},
			);

			// Calculate balance in USD with sanity check
			const balanceInUSD = wealthService.calculateBalanceInUSD(
				input.newBalance,
				resolvedRate.rate,
				asset.currency,
			);

			// Update asset and record snapshot in transaction
			const result = await db.$transaction(async (tx) => {
				await tx.$executeRaw`SELECT set_config('app.current_user_id', ${session.user.id}, true),
				                             set_config('role', 'retrospend_app', true)`;
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
					session.user.id,
				);

				return updatedAsset;
			});

			return result;
		}),

	updateAsset: protectedProcedure
		.input(
			z.object({
				id: z.string().cuid(),
				name: z.string().min(1).max(191),
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
				{ rate: input.exchangeRate, type: input.exchangeRateType },
			);

			// Calculate balance in USD with sanity check
			const balanceInUSD = wealthService.calculateBalanceInUSD(
				input.balance,
				rate,
				input.currency,
			);

			// Update asset and record snapshot in transaction
			const result = await db.$transaction(async (tx) => {
				await tx.$executeRaw`SELECT set_config('app.current_user_id', ${session.user.id}, true),
				                             set_config('role', 'retrospend_app', true)`;
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
					session.user.id,
				);

				return updatedAsset;
			});

			return result;
		}),

	getDashboard: protectedProcedure
		.input(z.object({ currency: z.string().length(3).optional() }).optional())
		.query(async ({ ctx, input }) => {
			const { db, session } = ctx;
			const targetCurrency = input?.currency ?? BASE_CURRENCY;
			const wealthService = new WealthService(db);

			return await wealthService.getDashboardSummary(
				session.user.id,
				targetCurrency,
			);
		}),

	getRunwayStats: protectedProcedure
		.input(z.object({ currency: z.string().length(3).optional() }).optional())
		.query(async ({ ctx, input }) => {
			const { db, session } = ctx;
			const targetCurrency = input?.currency ?? BASE_CURRENCY;
			const today = new Date();

			const userId = session.user.id;
			const sixMonthsAgo = addMonthsClamped(today, -6);

			// Same spending as every other total: finalized, not excluded,
			// amortized purchases counted once (through their monthly parts).
			const [oldestExpenseOverall, excludedProjectIds] = await Promise.all([
				db.expense.findFirst({
					where: spendingWhere(userId),
					orderBy: { date: "asc" },
					select: { date: true },
				}),
				getExcludedProjectIds(db, userId),
			]);

			let monthsActive = 6;
			if (oldestExpenseOverall) {
				const msDiff = today.getTime() - oldestExpenseOverall.date.getTime();
				const monthsDiff = msDiff / (1000 * 60 * 60 * 24 * 30.436875);
				monthsActive = Math.min(6, Math.max(1, monthsDiff));
			} else {
				monthsActive = 1;
			}

			const [items, targetRate] = await Promise.all([
				getSpendingItems(
					db,
					userId,
					{ gte: sixMonthsAgo, lte: today },
					excludedProjectIds,
				),
				findExchangeRate(db, targetCurrency, today),
			]);

			const averageMonthlySpend =
				sumIn(items, targetCurrency, targetRate?.rate) / monthsActive;

			return {
				averageMonthlySpend,
				monthsActive: Math.round(monthsActive),
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

		const today = new Date();
		const wealthService = new WealthService(db);
		const balancesInUSD = await Promise.all(
			assets.map(async (asset) => {
				const stored = toNumberOrNull(asset.exchangeRate);
				try {
					const { rate } = await wealthService.resolveExchangeRate(
						asset.currency,
						today,
						{ rate: stored, type: asset.exchangeRateType },
					);
					return toUSD(Number(asset.balance), asset.currency, rate);
				} catch {
					// No table rate: the asset's own stored rate, else left blank
					return isValidRate(stored)
						? toUSD(Number(asset.balance), asset.currency, stored)
						: null;
				}
			}),
		);

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

		const rows = assets.map((asset, i) => {
			const balanceInUSD = balancesInUSD[i];
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
				rows: z
					.array(
						z.object({
							name: z.string().min(1).max(191),
							type: z.nativeEnum(AssetType),
							currency: z.string().length(3),
							balance: z.number(),
							isLiquid: z.boolean(),
							interestRate: z.number().optional().nullable(),
							minimumPayment: z.number().optional().nullable(),
							dueDate: z.number().int().min(1).max(31).optional().nullable(),
						}),
					)
					.max(1000),
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
						await tx.$executeRaw`SELECT set_config('app.current_user_id', ${session.user.id}, true),
						                             set_config('role', 'retrospend_app', true)`;
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
							session.user.id,
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
