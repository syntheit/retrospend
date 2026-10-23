/**
 * Transport schemas of the Add family (routers/entry.ts, later /api/v1).
 * Amounts and typed rates are decimal strings as typed, days are
 * YYYY-MM-DD in the user's zone. `toExpenseInput` turns a form into the
 * expense service's input; undo inputs come back in the service's own shape
 * (what a mutation returned as `restore`), so they get their own schemas.
 */
import { parseDateOnlyIn } from "@retrospend/domain/time-zone";
import { z } from "zod";
import type { CreateExpenseInput } from "../expense.service";

const decimal = z
	.string()
	.regex(/^\d{1,13}(\.\d{1,12})?$/, "Enter an amount like 1234.56")
	.refine((v) => Number(v) > 0, "Enter an amount above zero");
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date");
const currency = z.string().min(3).max(10);
const id = z.string().min(1).max(64);
const rateType = z.string().min(1).max(32);

const expenseFields = {
	title: z.string().min(1).max(500),
	amount: decimal,
	currency,
	date: isoDay,
	categoryId: z.cuid(),
	/** A rate type of the pair (official, blue...); omitted: the default. */
	rateType: rateType.optional(),
	/** A typed rate: 1 unit of `currency` = this many of the home currency. */
	customRate: decimal.optional(),
	location: z.string().max(191).optional(),
	description: z.string().max(1000).optional(),
	amortizeOver: z.number().int().min(2).max(24).optional(),
	excludeFromAnalytics: z.boolean().optional(),
};

export const expenseFormSchema = z.object({ id, ...expenseFields });
export type ExpenseForm = z.infer<typeof expenseFormSchema>;

export function toExpenseInput(
	form: ExpenseForm,
	timeZone?: string,
): CreateExpenseInput {
	const { date, customRate, rateType: type, ...rest } = form;
	return {
		...rest,
		date: parseDateOnlyIn(date, timeZone),
		...(customRate
			? { customRate: { base: form.currency, value: Number(customRate) } }
			: type
				? { rateType: type }
				: {}),
	};
}

/** What expense.update or expense.delete returned as `restore`. */
export const expenseRestoreSchema = z.object({
	id,
	title: z.string().min(1).max(500),
	amount: z.union([z.number().positive(), decimal]),
	currency,
	date: z.date(),
	exchangeRate: z.number().positive().optional(),
	pricingSource: z.string().max(200).optional(),
	rateType: rateType.optional(),
	customRate: z
		.object({ base: currency, value: z.number().positive() })
		.optional(),
	location: z.string().max(191).optional(),
	description: z.string().max(1000).optional(),
	categoryId: z.string().min(1).optional(),
	amortizeOver: z.number().int().min(2).max(60).optional(),
	excludeFromAnalytics: z.boolean().optional(),
});

const participant = z.object({
	participantType: z.enum(["user", "guest", "shadow"]),
	participantId: z.string().min(1),
});
const splitRow = participant.extend({
	shareAmount: z.number().nonnegative().optional(),
	sharePercentage: z.number().min(0).max(100).optional(),
	shareUnits: z.number().int().positive().optional(),
});
const splitFields = {
	paidBy: participant,
	splitWith: z.array(splitRow).min(1),
	splitMode: z.enum(["EQUAL", "EXACT", "PERCENTAGE", "SHARES"]),
};

const sharedFields = {
	amount: decimal,
	currency,
	description: z.string().min(1).max(500),
	categoryId: z.cuid().optional(),
	date: isoDay,
	notes: z.string().max(5000).optional(),
	...splitFields,
};

export const sharedCreateSchema = z.object({
	/** A client id: a repeated create (a double click) writes one row. */
	id: z.uuid().optional(),
	...sharedFields,
	projectId: z.cuid().optional(),
});
export const sharedUpdateSchema = z.object({
	id,
	...sharedFields,
	// Sent on every edit, so an emptied note clears it.
	notes: z.string().max(5000).nullable(),
	projectId: z.cuid().nullable(),
});

/** Days and amounts in the shared service's shape. */
export function toSharedInput<
	T extends { amount: string; date: string; notes?: string | null },
>(form: T, timeZone?: string) {
	return {
		...form,
		amount: Number(form.amount),
		date: parseDateOnlyIn(form.date, timeZone),
	};
}

/** What sharedExpense.update returned as `restore`. */
export const sharedRestoreSchema = z.object({
	id,
	amount: z.number().positive(),
	currency,
	description: z.string().min(1).max(500),
	categoryId: z.string().nullable(),
	date: z.date(),
	notes: z.string().max(5000).nullable(),
	projectId: z.string().nullable(),
	...splitFields,
});

export const sharedDeleteSchema = z.object({
	id,
	confirmUnsettled: z.boolean().optional(),
	// The Undo of a create (see deleteSharedExpense).
	retract: z.boolean().optional(),
});

/** A signed undo payload (restore-token.ts). */
export const restoreTokenSchema = z.object({
	token: z.object({
		data: z.string().min(2).max(200_000),
		sig: z.string().regex(/^[0-9a-f]{64}$/),
	}),
});

export const rateOptionsSchema = z.object({
	currency,
	date: isoDay,
	/** The amount to book at each type, as typed. */
	amount: decimal.optional(),
});

export const defaultRateTypeSchema = z.object({
	homeCurrency: currency,
	rateType: rateType.nullable(),
});
