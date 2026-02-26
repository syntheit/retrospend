import { z } from "zod";
import { isCrypto } from "./currency-format";
import type { AssetType } from "./db-enums";
import { toNumberOrNull, toNumberWithDefault } from "./decimal";

export type NormalizedExpense = {
	id: string;
	title: string | null;
	amount: number;
	currency: string;
	exchangeRate: number | null;
	amountInUSD: number | null;
	pricingSource?: string;
	date: Date;
	location: string | null;
	description: string | null;
	categoryId: string | null;
	category: {
		id: string;
		name: string;
		color: string;
		icon?: string | null;
	} | null;
};

export type RawExpense = z.infer<typeof RawExpenseSchema>;

const RawExpenseSchema = z.object({
	id: z.string(),
	title: z.string().nullable().optional(),
	amount: z.unknown().optional(),
	currency: z.string().optional(),
	exchangeRate: z.unknown().nullable().optional(),
	amountInUSD: z.unknown().nullable().optional(),
	pricingSource: z.string().nullable().optional(),
	date: z.union([z.string(), z.date()]),
	location: z.string().nullable().optional(),
	description: z.string().nullable().optional(),
	categoryId: z.string().nullable().optional(),
	category: z
		.object({
			id: z.string(),
			name: z.string(),
			color: z.string(),
			icon: z.string().nullable().optional(),
		})
		.nullable()
		.optional(),
});

export function normalizeExpense(expense: RawExpense): NormalizedExpense {
	return {
		id: expense.id,
		title: expense.title ?? null,
		amount: Number(expense.amount ?? 0),
		currency: expense.currency ?? "USD",
		exchangeRate:
			expense.exchangeRate !== undefined && expense.exchangeRate !== null
				? Number(expense.exchangeRate)
				: null,
		amountInUSD:
			expense.amountInUSD !== undefined && expense.amountInUSD !== null
				? Number(expense.amountInUSD)
				: null,
		pricingSource: expense.pricingSource ?? undefined,
		date: expense.date instanceof Date ? expense.date : new Date(expense.date),
		location: expense.location ?? null,
		description: expense.description ?? null,
		categoryId: expense.categoryId ?? expense.category?.id ?? null,
		category: expense.category
			? {
					id: expense.category.id,
					name: expense.category.name,
					color: expense.category.color,
					icon: expense.category.icon,
				}
			: null,
	};
}

export function normalizeExpenses(expenses: RawExpense[]): NormalizedExpense[] {
	return expenses.map(normalizeExpense);
}

/**
 * Helper to normalize expenses from API responses that may contain Prisma Decimal types.
 * Safely validates the shape with Zod before normalization.
 */
export function normalizeExpensesFromApi(
	expenses: unknown[],
): NormalizedExpense[] {
	return normalizeExpenses(
		expenses.map((e) => {
			const result = RawExpenseSchema.safeParse(e);

			if (!result.success) {
				console.error("Invalid expense data from API:", result.error.format());
				throw new Error(
					`Failed to normalize expense: ${result.error.issues[0]?.message || "Unknown validation error"}`,
				);
			}

			const expense = result.data;
			return {
				...expense,
				amount: toNumberWithDefault(expense.amount),
				exchangeRate: toNumberOrNull(expense.exchangeRate),
				amountInUSD: toNumberOrNull(expense.amountInUSD),
			};
		}),
	);
}

/**
 * Raw asset data as returned from the API (before normalization)
 */
export interface RawAsset {
	id: string;
	name: string;
	type: AssetType;
	currency: string;
	balance: number;
	balanceInUSD: number;
	balanceInTargetCurrency?: number;
	exchangeRate: string | number | null; // Decimal | null from Prisma
	exchangeRateType?: string | null;
	isLiquid: boolean;
	interestRate?: number | null;
	createdAt?: Date;
	updatedAt?: Date;
}

/**
 * Normalized asset with proper types for frontend consumption
 */
export interface NormalizedAsset {
	id: string;
	name: string;
	type: AssetType;
	currency: string;
	balance: number;
	balanceInUSD: number;
	balanceInTargetCurrency: number;
	exchangeRate?: number;
	exchangeRateType?: string;
	isLiquid: boolean;
	interestRate?: number | null;
}

/**
 * Normalizes an asset from API format to frontend format.
 * Converts exchangeRate from string/null to number/undefined.
 */
export function normalizeAsset(asset: RawAsset): NormalizedAsset {
	const { exchangeRateType, ...rest } = asset;
	return {
		...rest,
		exchangeRate: asset.exchangeRate ? Number(asset.exchangeRate) : undefined,
		exchangeRateType: exchangeRateType || undefined,
		balanceInTargetCurrency:
			asset.balanceInTargetCurrency ?? asset.balanceInUSD,
	};
}

/**
 * Normalizes an array of assets.
 */
export function normalizeAssets(assets: RawAsset[]): NormalizedAsset[] {
	return assets.map(normalizeAsset);
}

/**
 * Gets the exchange rate to convert from USD to the target currency for an expense.
 * If the target currency matches the expense currency, uses the stored expense rate.
 * Otherwise, uses the provided live rate for the target currency.
 *
 * @param expense - The normalized expense
 * @param targetCurrency - The currency we want to display in
 * @param liveRateToTarget - The current exchange rate from USD to target currency
 * @returns The exchange rate to use for conversion
 */
export function getExpenseDisplayRate(
	expense: NormalizedExpense,
	targetCurrency: string,
	liveRateToTarget: number | null,
): number | null {
	// If target currency matches expense currency, use stored exchange rate
	if (targetCurrency === expense.currency && expense.exchangeRate) {
		return expense.exchangeRate;
	}

	// Otherwise, use the live rate to target currency
	return liveRateToTarget;
}

/**
 * Converts an expense amount to the target currency for display.
 * All expenses have amountInUSD, so we convert from USD to target currency.
 *
 * Math Rubric (CRITICAL):
 * - If target is Crypto: usdValue / cryptoRate (where rate is USD per Coin)
 * - If target is Fiat: usdValue * fiatRate (where rate is Units per USD)
 *
 * @param expense - The normalized expense
 * @param targetCurrency - The currency we want to display in
 * @param liveRateToTarget - The current exchange rate from USD to target currency
 * @returns The amount in the target currency
 */
export function convertExpenseAmountForDisplay(
	expense: NormalizedExpense,
	targetCurrency: string,
	liveRateToTarget: number | null,
): number {
	if (!expense.amountInUSD) {
		// Fallback to original amount if no USD amount (shouldn't happen per user)
		return expense.amount;
	}

	// Check if target currency matches expense currency first to avoid floating point errors
	if (targetCurrency === expense.currency) {
		return expense.amount;
	}

	const rate = getExpenseDisplayRate(expense, targetCurrency, liveRateToTarget);

	if (!rate) {
		// No rate available, return USD amount as fallback
		return expense.amountInUSD;
	}

	// RUBRIC ENFORCEMENT:
	// If target is crypto, divide USD by rate. If fiat, multiply.
	return isCrypto(targetCurrency)
		? expense.amountInUSD / rate
		: expense.amountInUSD * rate;
}
