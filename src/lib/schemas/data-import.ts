import { z } from "zod";
import { parseDateOnly } from "../date";

// Helper to coerce strings to numbers, handling currency formatting (e.g. "$1,200.00")
const numericString = z.preprocess((val) => {
	if (typeof val === "number") return val;
	if (typeof val === "string") {
		const cleaned = val.replace(/[^0-9.-]/g, ""); // Remove currency symbols, commas
		return cleaned === "" ? undefined : Number(cleaned);
	}
	return val;
}, z.number());

// Helper to coerce strings to dates
const dateString = z.preprocess((val) => {
	if (val instanceof Date) return val;
	if (typeof val === "string") {
		try {
			return parseDateOnly(val);
		} catch {
			return undefined;
		}
	}
	return undefined;
}, z.date());

const booleanString = z.preprocess((val) => {
	if (typeof val === "boolean") return val;
	if (typeof val === "string") {
		const v = val.toLowerCase().trim();
		return v === "true" || v === "yes" || v === "1";
	}
	return false;
}, z.boolean());

export const ExpenseImportSchema = z.object({
	title: z.string().min(1, "Title is required"),
	amount: numericString.refine((val) => val > 0, "Amount must be positive"),
	currency: z
		.string()
		.length(3, "Currency must be a 3-letter code")
		.toUpperCase(),
	date: dateString.refine(
		(val) => !Number.isNaN(val.getTime()),
		"Invalid date",
	),
	exchangeRate: numericString.optional(),
	amountInUSD: numericString.optional(),
	location: z.string().optional(),
	description: z.string().optional(),
	category: z.string().optional(), // Maps to categoryName in previous logic
	pricingSource: z.string().optional(),
});

export const BudgetImportSchema = z.object({
	categoryName: z.string().optional(),
	amount: numericString.refine(
		(val) => val >= 0,
		"Amount must be non-negative",
	),
	period: dateString.refine(
		(val) => !Number.isNaN(val.getTime()),
		"Invalid period/date",
	),
	isRollover: booleanString.optional().default(false),
	rolloverAmount: numericString.optional().default(0),
	pegToActual: booleanString.optional().default(false),
});

export const WealthImportSchema = z.object({
	name: z.string().min(1, "Name is required"),
	balance: numericString,
	currency: z
		.string()
		.length(3, "Currency must be a 3-letter code")
		.toUpperCase(),
	type: z.string().min(1, "Type is required").toUpperCase(), // We could refine this to AssetType if we share that Validation
	isLiquid: booleanString.optional().default(false),
	interestRate: numericString.optional(),
	minimumPayment: numericString.optional(),
	dueDate: numericString.optional(),
});

export type ExpenseImportRow = z.infer<typeof ExpenseImportSchema>;
export type BudgetImportRow = z.infer<typeof BudgetImportSchema>;
export type WealthImportRow = z.infer<typeof WealthImportSchema>;
