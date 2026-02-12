import { TRPCError } from "@trpc/server";
import { BASE_CURRENCY } from "~/lib/constants";
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
		const balanceInUSD = balance / rate;

		// Sanity check to prevent "Billion Dollar" bug (multiplying instead of dividing)
		if (currency !== BASE_CURRENCY && rate > 1 && balanceInUSD > balance) {
			throw new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message:
					"Exchange rate calculation sanity check failed. Please contact support.",
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
}
