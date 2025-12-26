import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { AssetType } from "~prisma";

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
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { db, session } = ctx;
			const today = normalizeDate(new Date());

			// 1. Determine exchange rate
			let rate = 1;
			let rateType = null;
			if (input.currency !== "USD") {
				if (input.exchangeRate && input.exchangeRateType) {
					// Use provided exchange rate
					rate = input.exchangeRate;
					rateType = input.exchangeRateType;
				} else {
					// Fetch exchange rate automatically
					const exchangeRate = await db.exchangeRate.findFirst({
						where: {
							currency: input.currency,
							date: { lte: today }, // Get latest available
						},
						orderBy: { date: "desc" },
					});

					if (exchangeRate) {
						rate = exchangeRate.rate.toNumber();
						rateType = exchangeRate.type;
					} else {
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: `No exchange rate found for ${input.currency}. Please sync rates or provide a custom rate.`,
						});
					}
				}
			}

			// Calculate balance in USD
			// rate is Currency per USD. So USD = Amount / Rate
			const balanceInUSD = input.balance / rate;

			// 2. Create AssetAccount and Snapshot in a transaction
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

			// 1. Determine exchange rate
			let rate = 1;
			let rateType = asset.exchangeRateType;
			if (asset.currency !== "USD") {
				if (input.exchangeRate && input.exchangeRateType) {
					// Use provided exchange rate
					rate = input.exchangeRate;
					rateType = input.exchangeRateType;
				} else {
					// Use existing rate or fetch new one
					if (asset.exchangeRate) {
						rate = asset.exchangeRate.toNumber();
					} else {
						const exchangeRate = await db.exchangeRate.findFirst({
							where: {
								currency: asset.currency,
								date: { lte: today },
							},
							orderBy: { date: "desc" },
						});

						if (exchangeRate) {
							rate = exchangeRate.rate.toNumber();
							rateType = exchangeRate.type;
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

			// 2. Update Asset and Upsert Snapshot
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
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const { db, session } = ctx;
			const today = normalizeDate(new Date());

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

			// Determine exchange rate
			let rate = 1;
			let rateType = null;
			if (input.currency !== "USD") {
				if (input.exchangeRate && input.exchangeRateType) {
					// Use provided exchange rate
					rate = input.exchangeRate;
					rateType = input.exchangeRateType;
				} else {
					// Fetch exchange rate automatically
					const exchangeRate = await db.exchangeRate.findFirst({
						where: {
							currency: input.currency,
							date: { lte: today }, // Get latest available
						},
						orderBy: { date: "desc" },
					});

					if (exchangeRate) {
						rate = exchangeRate.rate.toNumber();
						rateType = exchangeRate.type;
					} else {
						throw new TRPCError({
							code: "BAD_REQUEST",
							message: `No exchange rate found for ${input.currency}. Please sync rates or provide a custom rate.`,
						});
					}
				}
			}

			// Calculate balance in USD
			// rate is Currency per USD. So USD = Amount / Rate
			const balanceInUSD = input.balance / rate;

			// Update Asset and upsert snapshot
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

				return updatedAsset;
			});

			return result;
		}),

	getDashboard: protectedProcedure.query(async ({ ctx }) => {
		const { db, session } = ctx;
		const today = normalizeDate(new Date());

		// Fetch all assets
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
				createdAt: true,
				updatedAt: true,
			},
		});

		// Calculate total net worth (live calculation based on current rates)
		// We need rates for all asset currencies
		const currencies = [...new Set(assets.map((a) => a.currency))];
		const rates = new Map<string, number>();
		rates.set("USD", 1);

		for (const currency of currencies) {
			if (currency === "USD") continue;
			const rateEntry = await db.exchangeRate.findFirst({
				where: { currency, date: { lte: today } },
				orderBy: { date: "desc" },
			});
			if (rateEntry) {
				rates.set(currency, rateEntry.rate.toNumber());
			}
		}

		let totalNetWorth = 0;
		const assetsWithUSD = assets.map((asset) => {
			const rate = rates.get(asset.currency) || 1; // Default to 1 if missing (maybe risky but better than 0?)
			// Check if we should warn about missing rate?
			// If we strictly enforced rate existence in create/update, we should be fine mostly.
			const balanceInUSD = asset.balance.toNumber() / rate;
			totalNetWorth += balanceInUSD;
			return {
				...asset,
				balance: asset.balance.toNumber(),
				balanceInUSD,
			};
		});

		// History: Last 12 months
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

		// Build history map: date -> totalUSD
		// Problem: snapshots are sparse. We need to fill forward.
		// 1. Get all unique dates in the range (or just use snapshot dates if we only care about change points?
		//    Usually charts look better with continuous lines, but points are ok too.
		//    Requirement: "Array of { date, totalUSD }")
		// Let's create a map of Date -> Map<AssetId, BalanceUSD>

		// To do fill-forward properly, we need the initial state at oneYearAgo.
		// We can fetch the latest snapshot BEFORE oneYearAgo for each asset.

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

		// Current balances map
		const currentBalances = new Map<string, number>();
		initialSnapshots.forEach((snap, index) => {
			const asset = assets[index];
			if (asset) {
				if (snap) {
					currentBalances.set(asset.id, snap.balanceInUSD.toNumber());
				} else {
					// No previous snapshot, assume 0 or start from first snapshot found in range
					currentBalances.set(asset.id, 0);
				}
			}
		});

		// Group snapshots by date string (ISO)
		const snapshotsByDate = new Map<string, typeof snapshots>();
		snapshots.forEach((s) => {
			const dateStr = s.date?.toISOString().split("T")[0];
			if (!dateStr) return; // Skip if date parsing failed
			const existing = snapshotsByDate.get(dateStr);
			if (!existing) {
				snapshotsByDate.set(dateStr, [s]);
			} else {
				existing.push(s);
			}
		});

		// Generate daily points or just use the dates we have?
		// If we only use dates we have, the graph might look jagged or skip days.
		// Let's just use the dates present in snapshots + today.
		// Or simpler: iterate through all days? 365 iterations is fast.

		const history: { date: string; totalUSD: number }[] = [];

		// Get all unique dates from snapshots
		const sortedDates = [...snapshotsByDate.keys()].sort();

		// If we want a smooth graph, we should probably output every day?
		// But for now, let's output points where changes happened, plus maybe start/end.
		// Actually, "last 12 months" implies a time series.
		// If I only return change points, the frontend chart library usually handles interpolation (linear).
		// Step interpolation would be more accurate for balances (balance stays constant until changed).
		// But let's return the computed totals for the dates where we have data, ensuring we update the running totals.

		for (const dateStr of sortedDates) {
			const daysSnapshots = snapshotsByDate.get(dateStr);
			if (!daysSnapshots) continue; // Should not happen, but safety check

			// Update current balances
			daysSnapshots.forEach((snap) => {
				currentBalances.set(snap.accountId, snap.balanceInUSD.toNumber());
			});

			// Sum up
			let total = 0;
			for (const bal of currentBalances.values()) {
				total += bal;
			}

			history.push({ date: dateStr, totalUSD: total });
		}

		// Ensure we include "today" if not present?
		// Accounts have "current balance" which might be newer than last snapshot if updated today.
		// Actually, updateBalance upserts today's snapshot. So today should be covered if there were updates today.
		// If no updates today, the last point in history might be old.
		// We should probably append { date: today, totalUSD: totalNetWorth } if the last date is not today.

		const todayStr = today.toISOString().split("T")[0]!;
		const lastEntry = history[history.length - 1];
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		if (history.length === 0 || !lastEntry || lastEntry.date !== todayStr) {
			history.push({ date: todayStr, totalUSD: totalNetWorth! });
		}

		return {
			totalNetWorth,
			assets: assetsWithUSD,
			history,
		};
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

		// Get exchange rates for USD conversion
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

		// Create a map of latest rates
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

		const escapeValue = (raw: unknown): string => {
			if (raw === null || raw === undefined) return "";
			const value =
				raw instanceof Date
					? (raw.toISOString().split("T")[0] ?? "")
					: typeof raw === "number" || typeof raw === "bigint"
						? raw.toString()
						: String(raw);

			const needsEscaping = /["\n,]/.test(value);
			if (!needsEscaping) return value;
			return `"${value.replace(/"/g, '""')}"`;
		};

		const rows = assets.map((asset) => {
			const rate = rateMap.get(asset.currency) || 1;
			const balanceInUSD = asset.balance.toNumber() / rate;
			return [
				escapeValue(asset.name),
				escapeValue(asset.type),
				escapeValue(asset.currency),
				escapeValue(asset.balance),
				escapeValue(balanceInUSD),
				escapeValue(asset.exchangeRate),
				escapeValue(asset.exchangeRateType),
				escapeValue(asset.isLiquid),
				escapeValue(asset.createdAt),
				escapeValue(asset.updatedAt),
			];
		});

		const csv = [header, ...rows].map((row) => row.join(",")).join("\n");

		return { csv };
	}),
});
