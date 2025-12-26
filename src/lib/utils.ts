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

export function getCurrencyName(currency: string): string {
	const currencyData =
		CURRENCIES[currency.toUpperCase() as keyof typeof CURRENCIES];
	return currencyData?.name || currency.toUpperCase();
}

export function formatCurrencyAmount(amount: number): string {
	return new Intl.NumberFormat("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(amount);
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
