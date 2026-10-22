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

/** A closed account takes no changes until it is reopened. */
function assertOpen(asset: { closedAt: Date | null }) {
	if (asset.closedAt) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "This account is closed. Reopen it to change it.",
		});
	}
}

export const wealthRouter = createTRPCRouter({
	createAsset: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1).max(191),
				type: z.enum(AssetType),
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
					{ currency: input.currency, type: input.type, exchangeRateType: rateType },
				);

				return account;
			});

			return result;
		}),

	updateAssetBalance: protectedProcedure
		.input(
			z.object({
				assetId: z.cuid(),
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
			assertOpen(asset);

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
					{
						currency: asset.currency,
						type: asset.type,
						exchangeRateType: resolvedRate.rateType,
					},
				);

				return updatedAsset;
			});

			return result;
		}),

	updateAsset: protectedProcedure
		.input(
			z.object({
				id: z.cuid(),
				name: z.string().min(1).max(191),
				type: z.enum(AssetType),
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
			assertOpen(existingAsset);

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
					{ currency: input.currency, type: input.type, exchangeRateType: rateType },
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
	/**
	 * Closes an account: it leaves today's totals and counts 0 in the history
	 * from today on, but its past balances stay. The balance is kept on the
	 * account so reopening brings it back.
	 */
	closeAsset: protectedProcedure
		.input(z.object({ id: z.cuid() }))
		.mutation(async ({ ctx, input }) => {
			const { db, session } = ctx;
			const now = new Date();
			const today = normalizeDate(now);
			const wealthService = new WealthService(db);

			const asset = await db.assetAccount.findFirst({
				where: { id: input.id, userId: session.user.id },
			});
			if (!asset) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Asset not found" });
			}
			if (asset.closedAt) return { success: true };

			await db.$transaction(async (tx) => {
				await tx.$executeRaw`SELECT set_config('app.current_user_id', ${session.user.id}, true),
				                             set_config('role', 'retrospend_app', true)`;
				await tx.assetAccount.update({
					where: { id: asset.id },
					data: { closedAt: now },
				});
				// A zero point on the closing day, so the chart drops there.
				await wealthService.recordAssetSnapshot(
					tx,
					asset.id,
					today,
					0,
					0,
					session.user.id,
					{
						currency: asset.currency,
						type: asset.type,
						exchangeRateType: asset.exchangeRateType,
					},
				);
			});

			return { success: true };
		}),

	/**
	 * Reopens a closed account with the balance it had. That balance is
	 * recorded for today, so the history picks the account up again from the
	 * day it was reopened (the closed days stay at 0).
	 */
	reopenAsset: protectedProcedure
		.input(z.object({ id: z.cuid() }))
		.mutation(async ({ ctx, input }) => {
			const { db, session } = ctx;
			const today = normalizeDate(new Date());
			const wealthService = new WealthService(db);

			const asset = await db.assetAccount.findFirst({
				where: { id: input.id, userId: session.user.id },
			});
			if (!asset) {
				throw new TRPCError({ code: "NOT_FOUND", message: "Asset not found" });
			}
			if (!asset.closedAt) return { success: true };

			const balance = Number(asset.balance);
			const stored = toNumberOrNull(asset.exchangeRate);
			let rate: number | null;
			try {
				({ rate } = await wealthService.resolveExchangeRate(
					asset.currency,
					today,
					{ rate: stored, type: asset.exchangeRateType },
				));
			} catch {
				// No table rate: the account's own stored rate, if any
				rate = isValidRate(stored) ? stored : null;
			}
			const balanceInUSD =
				rate === null ? 0 : toUSD(balance, asset.currency, rate);

			await db.$transaction(async (tx) => {
				await tx.$executeRaw`SELECT set_config('app.current_user_id', ${session.user.id}, true),
				                             set_config('role', 'retrospend_app', true)`;
				await tx.assetAccount.update({
					where: { id: asset.id },
					data: { closedAt: null },
				});
				await wealthService.recordAssetSnapshot(
					tx,
					asset.id,
					today,
					balance,
					balanceInUSD,
					session.user.id,
					{
						currency: asset.currency,
						type: asset.type,
						exchangeRateType: asset.exchangeRateType,
					},
				);
			});

			return { success: true };
		}),

	/**
	 * Deletes an account and its whole balance history, as if it never
	 * existed. Past net worth changes; closing is the way to keep it.
	 */
	deleteAssetPermanently: protectedProcedure
		.input(z.object({ id: z.cuid() }))
		.mutation(async ({ ctx, input }) => {
			const { db, session } = ctx;

			// Snapshots and history go with it (onDelete: Cascade).
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

		// Open accounts only, like the wealth page; closed ones are in the
		// full data export.
		const assets = await db.assetAccount.findMany({
			where: {
				userId: session.user.id,
				closedAt: null,
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
							type: z.enum(AssetType),
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
					// Find an open account by name; a closed one keeps its history
					// and a new account is created next to it.
					const existing = await db.assetAccount.findFirst({
						where: {
							userId: session.user.id,
							name: row.name,
							closedAt: null,
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
							{ currency: row.currency, type: row.type, exchangeRateType: rateType },
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
