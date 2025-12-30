import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { CURRENCIES } from "./currencies";
import type { AssetType } from "./db-enums";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export function getCurrencySymbol(
	currency: string,
	useNativeForDefault = false,
): string {
	const currencyData =
		CURRENCIES[currency.toUpperCase() as keyof typeof CURRENCIES];
	if (useNativeForDefault) {
		return currencyData?.symbol_native || currency.toUpperCase();
	}
	return currencyData?.symbol || currency.toUpperCase();
}

/**
 * Gets the currency symbol based on user preference (native or standard).
 */
export function getCurrencySymbolWithPreference(
	currency: string,
	currencySymbolStyle: "native" | "standard" = "standard",
): string {
	const currencyData =
		CURRENCIES[currency.toUpperCase() as keyof typeof CURRENCIES];
	return currencySymbolStyle === "native"
		? currencyData?.symbol_native ||
				currencyData?.symbol ||
				currency.toUpperCase()
		: currencyData?.symbol || currency.toUpperCase();
}

export function getCurrencyName(currency: string): string {
	const currencyData =
		CURRENCIES[currency.toUpperCase() as keyof typeof CURRENCIES];
	return currencyData?.name || currency.toUpperCase();
}

/**
 * Formats a currency amount using proper Intl.NumberFormat with currency style.
 * Automatically handles symbols, locale, and decimal digits based on currency.
 */
export function formatCurrency(
	amount: number,
	currency = "USD",
	currencySymbolStyle: "native" | "standard" = "standard",
): string {
	const currencyData =
		CURRENCIES[currency.toUpperCase() as keyof typeof CURRENCIES];

	// Get locale from home currency - for now we use a currency-appropriate locale
	// USD/CAD/AUD -> en-US, EUR -> de-DE, etc. Fallback to en-US
	const getLocaleForCurrency = (curr: string): string => {
		const localeMap: Record<string, string> = {
			USD: "en-US",
			CAD: "en-CA",
			EUR: "de-DE",
			GBP: "en-GB",
			JPY: "ja-JP",
			CHF: "de-CH",
			AUD: "en-AU",
			CNY: "zh-CN",
		};
		return localeMap[curr.toUpperCase()] || "en-US";
	};

	const locale = getLocaleForCurrency(currency);
	const decimalDigits = currencyData?.decimal_digits ?? 2;

	// Choose symbol based on preference
	const symbol =
		currencySymbolStyle === "native"
			? currencyData?.symbol_native ||
				currencyData?.symbol ||
				currency.toUpperCase()
			: currencyData?.symbol || currency.toUpperCase();

	// Format the number part
	const formattedNumber = new Intl.NumberFormat(locale, {
		minimumFractionDigits: decimalDigits,
		maximumFractionDigits: decimalDigits,
	}).format(amount);

	// Combine symbol and number
	return `${symbol}${formattedNumber}`;
}

/**
 * @deprecated Use formatCurrency instead. This function manually adds symbols which can cause duplication.
 */
export function formatCurrencyAmount(amount: number, currency = "USD"): string {
	const symbol = getCurrencySymbol(currency);
	return `${symbol}${new Intl.NumberFormat("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(amount)}`;
}

/**
 * Generates a UUID with graceful fallback for browsers that lack crypto.randomUUID
 * (e.g., some mobile WebView/Edge variants).
 */
export function generateId(): string {
	if (typeof crypto !== "undefined") {
		if (typeof crypto.randomUUID === "function") {
			return crypto.randomUUID();
		}

		if (typeof crypto.getRandomValues === "function") {
			const bytes = crypto.getRandomValues(new Uint8Array(16));
			return formatAsUuid(bytes);
		}
	}

	// Last-resort fallback (non-cryptographic) that still matches UUID v4 format.
	const bytes = new Uint8Array(16);
	for (let i = 0; i < 16; i++) {
		bytes[i] = Math.floor(Math.random() * 256);
	}
	return formatAsUuid(bytes);
}

const formatAsUuid = (bytes: Uint8Array): string => {
	// Ensure we have exactly 16 bytes for UUID generation
	if (bytes.length !== 16) {
		throw new Error("UUID generation requires exactly 16 bytes");
	}

	// Set version (4) and variant bits to match UUID v4 format.
	// Type assertion is safe since we've verified the array length
	const uuidBytes = bytes as Uint8Array & { 6: number; 8: number };
	uuidBytes[6] = (uuidBytes[6] & 0x0f) | 0x40;
	uuidBytes[8] = (uuidBytes[8] & 0x3f) | 0x80;

	const byteToHex = Array.from(bytes, (byte) =>
		byte.toString(16).padStart(2, "0"),
	);

	return [
		byteToHex.slice(0, 4).join(""),
		byteToHex.slice(4, 6).join(""),
		byteToHex.slice(6, 8).join(""),
		byteToHex.slice(8, 10).join(""),
		byteToHex.slice(10, 16).join(""),
	].join("-");
};

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
	} | null;
};

export type RawExpense = {
	id: string;
	title?: string | null;
	amount?: number | string;
	currency?: string;
	exchangeRate?: number | string | null;
	amountInUSD?: number | string | null;
	pricingSource?: string | null;
	date: string | Date;
	location?: string | null;
	description?: string | null;
	categoryId?: string | null;
	category?: {
		id: string;
		name: string;
		color: string;
	} | null;
};

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
				}
			: null,
	};
}

export function normalizeExpenses(expenses: RawExpense[]): NormalizedExpense[] {
	return expenses.map(normalizeExpense);
}

/**
 * Helper to normalize expenses from API responses that may contain Prisma Decimal types.
 * Safely converts Decimal objects to plain numbers before normalization.
 */
export function normalizeExpensesFromApi(expenses: any[]): NormalizedExpense[] {
	return normalizeExpenses(
		expenses.map((expense) => ({
			...expense,
			amount:
				typeof expense.amount?.toNumber === "function"
					? expense.amount.toNumber()
					: Number(expense.amount),
			exchangeRate:
				typeof expense.exchangeRate?.toNumber === "function"
					? expense.exchangeRate.toNumber()
					: Number(expense.exchangeRate) || null,
			amountInUSD:
				typeof expense.amountInUSD?.toNumber === "function"
					? expense.amountInUSD.toNumber()
					: Number(expense.amountInUSD) || null,
		})),
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
	exchangeRate: string | number | null; // Decimal | null from Prisma
	exchangeRateType: string | null;
	isLiquid: boolean;
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
	exchangeRate?: number;
	exchangeRateType?: string;
	isLiquid: boolean;
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

	const rate = getExpenseDisplayRate(expense, targetCurrency, liveRateToTarget);

	if (!rate) {
		// No rate available, return USD amount as fallback
		return expense.amountInUSD;
	}

	// Convert from USD to target currency
	return expense.amountInUSD * rate;
}
