/** The shapes the category vectors are written in. See category-vectors.ts for the rules the values are derived from. */
import type { WriteBody } from "./device/book";
import type { CategoryOp } from "./device/category-book";
import type { ExpenseSeed } from "./expense-create-conformance";

export { ARS, NOV10, RATES, uuid } from "./account-vector-types";

/** A category the case starts with, as the server stores it. */
export interface SeedCategory {
	id: string;
	name: string;
	color: string;
	kind: "EXPENSE" | "INCOME";
	icon?: string | null;
	excludeByDefault?: boolean;
	version?: number;
}

export interface ExpectedCategory {
	name: string;
	color: string;
	icon: string | null;
	kind: "EXPENSE" | "INCOME";
	excludeByDefault: boolean;
	version: number;
}

/** The columns of a new expense a category's default can decide. */
export interface ExpectedExpense {
	categoryId: string | null;
	categoryKind: "EXPENSE" | "INCOME" | null;
	excludeFromAnalytics: boolean;
	currency: string;
	amount: string;
	homeAmount: string | null;
}

/** What a step leaves, by the id the vector names. Absent keys are not checked. */
export interface ExpectedCategoryState {
	categories?: Record<string, ExpectedCategory>;
	/** How many categories the person has. */
	categoryCount?: number;
	expenses?: Record<string, ExpectedExpense>;
	/** The `spent` figure this month: one line per currency spent, [] when nothing counts. */
	spent?: { currency: string; minor: number }[];
}

export type CategoryStepExpect =
	| { done: ExpectedCategoryState }
	/** The write is refused in these words and stores nothing. */
	| { refused: string };

export interface CategoryStep {
	/** The instant the write runs at. */
	now: string;
	/** A category write, or the expense a category's default is held against. */
	op: CategoryOp | { kind: "create"; body: WriteBody };
	expect: CategoryStepExpect;
}

export interface CategoryVector {
	name: string;
	seed: ExpenseSeed;
	categories?: SeedCategory[];
	steps: CategoryStep[];
}
