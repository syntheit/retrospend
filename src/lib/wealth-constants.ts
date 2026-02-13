/**
 * Constants and configuration for the Wealth module.
 * Centralizing these values prevents magic strings and ensures consistency across the module.
 */

export const DEFAULT_CURRENCY = "USD";

export const TIME_RANGES = [
	{ label: "3M", value: "3M", months: 3 },
	{ label: "6M", value: "6M", months: 6 },
	{ label: "1Y", value: "12M", months: 12 },
	{ label: "All", value: "all", months: null },
] as const;

export type TimeRangeValue = (typeof TIME_RANGES)[number]["value"];

export const ASSET_COLORS: Record<string, string> = {
	CASH: "hsl(160, 84%, 39%)", // Emerald
	INVESTMENT: "hsl(217, 91%, 60%)", // Blue
	CRYPTO: "hsl(263, 70%, 50%)", // Violet
	REAL_ESTATE: "hsl(38, 92%, 50%)", // Amber/Gold
	LIABILITY_LOAN: "hsl(0, 84%, 60%)", // Red/Danger
	LIABILITY_CREDIT_CARD: "hsl(25, 95%, 53%)", // Orange
	LIABILITY_MORTGAGE: "hsl(32, 95%, 40%)", // Brown/Earth
	OTHER: "hsl(25, 95%, 53%)",
};

export const ASSET_LABELS: Record<string, string> = {
	CASH: "Cash",
	INVESTMENT: "Investment",
	CRYPTO: "Crypto",
	REAL_ESTATE: "Real Estate",
	LIABILITY_LOAN: "Loans",
	LIABILITY_CREDIT_CARD: "Credit Cards",
	LIABILITY_MORTGAGE: "Mortgages",
};
