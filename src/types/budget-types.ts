export interface Category {
	id: string;
	name: string;
	color: string;
	icon?: string | null;
}

export interface Budget {
	id: string;
	amount: number;
	amountInUSD: number;
	currency: string;
	actualSpend: number;
	actualSpendInUSD: number;
	effectiveAmount: number;
	effectiveAmountInUSD: number;
	pegToActual: boolean;
	type: "FIXED" | "PEG_TO_ACTUAL" | "PEG_TO_LAST_MONTH";
	category?: Category | null;
}

export type BudgetMode = "GLOBAL_LIMIT" | "SUM_OF_CATEGORIES";
