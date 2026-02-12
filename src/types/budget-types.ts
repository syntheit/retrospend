export interface Category {
	id: string;
	name: string;
	color: string;
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
	category?: Category | null;
}

export type BudgetMode = "GLOBAL_LIMIT" | "SUM_OF_CATEGORIES";
