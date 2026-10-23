/**
 * Transport schemas for accounts, transfers and income (routers/wealth.ts,
 * later /api/v1). Money moved between places is a decimal string, never a
 * float: the services read it as typed (I21). The legacy account forms keep
 * their number fields until stream 4 rebuilds them.
 */
import { z } from "zod";
import { restChoiceSchema } from "~/lib/schemas/envelope";
import { AssetType, RecurringFrequency, TransferKind } from "~prisma";

const decimal = z
	.string()
	.regex(/^-?\d{1,13}(\.\d{1,8})?$/, "Enter an amount like 1234.56");
const positive = decimal.refine(
	(v) => !v.startsWith("-"),
	"Enter an amount above zero",
);
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date");
const currency = z.string().min(3).max(10);
const id = z.string().min(1);
const rateType = z.string().min(1).max(32);

const accountFields = {
	name: z.string().min(1).max(191),
	type: z.enum(AssetType),
	currency: z.string().length(3),
	balance: z.number(),
	exchangeRate: z.number().optional(),
	exchangeRateType: z.string().optional(),
	isLiquid: z.boolean().default(false),
	interestRate: z.number().optional(),
	minimumPayment: z.number().optional(),
	dueDate: z.number().int().min(1).max(31).optional(),
	inBudget: z.boolean().nullish(),
};

export const createAccountSchema = z.object(accountFields);
export const editAccountSchema = z.object({ id: z.cuid(), ...accountFields });

export const importAccountsSchema = z.object({
	rows: z
		.array(
			z.object({
				name: z.string().min(1).max(191),
				type: z.enum(AssetType),
				currency: z.string().length(3),
				balance: z.number(),
				isLiquid: z.boolean(),
				interestRate: z.number().optional().nullable(),
				minimumPayment: z.number().optional().nullable(),
				dueDate: z.number().int().min(1).max(31).optional().nullable(),
			}),
		)
		.max(1000),
});

/** The old Update balance dialog: a number, as before. */
export const legacyBalanceSchema = z.object({
	assetId: z.cuid(),
	newBalance: z.number(),
	exchangeRate: z.number().optional(),
	exchangeRateType: z.string().optional(),
});

export const updateBalanceSchema = z.object({
	accountId: id,
	balance: decimal,
	rateType: rateType.nullish(),
	exchangeRate: z.number().positive().nullish(),
});

export const revertBalanceUpdateSchema = z.object({
	accountId: id,
	legId: id.nullable(),
	rateTypeId: id.nullable(),
	/** The update's previousRate, put back as stored. */
	previousRate: z
		.string()
		.regex(/^\d{1,16}(\.\d{1,12})?$/, "Enter a rate like 1412.5")
		.nullish(),
});

export const setRateTypeSchema = z.object({
	accountId: id,
	rateType: rateType.nullable(),
	from: isoDay.nullish(),
});

export const setDefaultAccountSchema = z.object({
	currency,
	accountId: id.nullable(),
});

export const createTransferSchema = z.object({
	/** A client id: a repeated save (a double click) writes one move. */
	id: z.uuid().optional(),
	fromAccountId: id.nullable(),
	toAccountId: id.nullable(),
	fromCurrency: currency.nullish(),
	toCurrency: currency.nullish(),
	fromAmount: positive,
	toAmount: positive.nullish(),
	kind: z.enum(TransferKind).nullish(),
	date: isoDay.nullish(),
	note: z.string().max(500).nullish(),
	fee: z.object({ amount: positive, accountId: id.nullish() }).nullish(),
	envelopeId: id.nullish(),
	putIn: id.nullish(),
});

/** The undo of a delete brings the move back with its own id. */
export const recreateTransferSchema = createTransferSchema.extend({ id });

export const transferIdSchema = z.object({ transferId: id });

export const addIncomeSchema = z.object({
	/** A client id: a repeated save (a double click) writes one income. */
	id: z.uuid().optional(),
	title: z.string().min(1).max(191),
	amount: positive,
	currency,
	rateType: rateType.nullish(),
	categoryId: id.nullish(),
	description: z.string().max(1000).nullish(),
	date: isoDay.nullish(),
	into: id.nullish(),
	keep: z.boolean().nullish(),
	repeats: z
		.object({ frequency: z.enum(RecurringFrequency), next: isoDay.nullish() })
		.nullish(),
	usePlan: z.boolean().optional(),
	/** Where Use my plan puts the rest; Leave it when omitted. */
	planRest: restChoiceSchema.optional(),
});

const storedDecimal = z.string().regex(/^-?\d{1,20}(\.\d{1,12})?$/);

/** income.delete's recreate input: the same row, at the rates it was booked at. */
export const recreateIncomeSchema = addIncomeSchema.extend({
	id,
	restore: z
		.object({
			exchangeRate: storedDecimal,
			amountInUSD: storedDecimal,
			units: storedDecimal.nullable(),
			homeAmount: storedDecimal.nullable(),
			homeCurrency: currency.nullable(),
			countedUnits: storedDecimal.nullish(),
		})
		.nullish(),
});

export const deleteIncomeSchema = z.object({
	expenseId: id,
	templateId: id.nullish(),
});

export const moveInSchema = z.union([
	z.object({ expenseId: id, putIn: id.nullish(), date: isoDay.nullish() }),
	z.object({
		/** Client id of the move: its undo removes exactly this one. */
		id: z.string().uuid(),
		accountId: id,
		units: positive,
		putIn: id.nullish(),
		date: isoDay.nullish(),
	}),
]);

export const confirmRecurringIncomeSchema = z.object({
	templateId: z.cuid(),
	dueDate: z.date().nullish(),
	/** The real amount as typed, when the template's amount varies. */
	amount: positive.nullish(),
	into: id.nullish(),
	keep: z.boolean().nullish(),
	usePlan: z.boolean().optional(),
	/** Where Use my plan puts the rest; Leave it when omitted. */
	planRest: restChoiceSchema.optional(),
});

export const unconfirmRecurringIncomeSchema = z.object({ expenseId: id });
