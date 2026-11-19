/**
 * Editing and deleting a person's expense, once, for the server and the
 * device. What the core touches (the row, the category, the rate table,
 * the write) comes through a port, so the server's Prisma adapter and the
 * device's store adapter run the same rules and write the same row.
 *
 * Edit reads in a fixed order, so the same input fails with the same error
 * on the server and the device. The row is read once, then refused in this
 * order: the row (the policy), the caller's afterRead hook (the server's
 * other-home refusal), the leg check, a changed category, the amount above 0,
 * then the rate. That is the tRPC and legacy order. v1 checks the category
 * before the row today, so its caller passes `categoryFirst` and the changed
 * category is refused ahead of the row, the hook and the leg check; the rest
 * keeps its order. Nothing is written before the last read. Refusals are
 * EditRefusal (row), CategoryNotFoundError and AmountRefusedError;
 * MissingRateError and RateInputError pass through.
 *
 * Spread parts are not the core's: the server's hooks sync or remove them,
 * the device refuses a spread before it gets here.
 */
import { dec, toFloat } from "../precise-decimal";
import {
	type BookContext,
	bookRate,
	type RateInput,
	rateChoice,
	type SavedRate,
} from "../rate-booking";
import { type CategoryFacts, expenseCategory } from "./category";
import { positiveAmount } from "./create";
import {
	checkDeletable,
	type EditPolicy,
	type ReachFacts,
	reach,
} from "./policy";
import { EditRefusal, LEG_EDIT_REFUSED } from "./refusals";

/** An expense as the core reads it. Decimals are plain decimal text. */
export interface StoredExpense extends ReachFacts {
	id: string;
	title: string;
	amount: string;
	currency: string;
	date: Date;
	isAmortizedParent: boolean;
	exchangeRate: string;
	amountInUSD: string;
	rateType: string | null;
	homeCurrency: string | null;
	homeRate: string | null;
	homeAmount: string | null;
	pricingSource: string | null;
	location: string | null;
	description: string | null;
	categoryId: string | null;
	excludeFromAnalytics: boolean;
}

/** The booked rate columns of a row, as decimal text. */
export interface SavedFigures {
	exchangeRate: string;
	amountInUSD: string;
	rateType: string | null;
	homeCurrency: string | null;
	homeRate: string | null;
	homeAmount: string | null;
}

/** What an edit changes on the row. `undefined` is "leave it", `null` clears. */
export interface ExpensePatch extends SavedFigures {
	title: string;
	amount: string;
	currency: string;
	date: Date;
	pricingSource: string | undefined;
	location: string | null;
	description: string | null;
	categoryId: string | null;
	isAmortizedParent: boolean;
	excludeFromAnalytics: boolean | undefined;
}

export interface ExpenseEditPort {
	/** The person's expense with this id, whatever its kind, or null. */
	expense(id: string): Promise<StoredExpense | null>;
	/** The person's category with this id (the owner checks its kind), or null. */
	category(id: string): Promise<CategoryFacts | null>;
	/** The home currency, the preferred rate type and the rate table. */
	rateBook(): Promise<BookContext>;
	/** Applies the patch and returns the row as stored after it. */
	write(id: string, patch: ExpensePatch): Promise<StoredExpense>;
	/** Deletes the row; the adapter takes its spread parts with it. */
	remove(row: StoredExpense): Promise<void>;
}

/** The fields the expense form saves; `id` names the row. */
export interface EditInput extends RateInput {
	id: string;
	title: string;
	location?: string;
	description?: string;
	categoryId?: string;
	amortizeOver?: number;
	excludeFromAnalytics?: boolean;
}

export interface EditHooks {
	/** Runs once the row is found, before anything else is checked. */
	afterRead?: (row: StoredExpense) => Promise<void>;
	/**
	 * The figures an undo signed, read where the rate would be booked: an
	 * undo puts back what was stored, and booking again could round differently.
	 */
	restoredFigures?: () => Promise<SavedFigures>;
	/** Runs after the write: the server's spread parts. */
	afterWrite?: (after: StoredExpense, amortizeOver: number) => Promise<void>;
}

export interface EditOptions extends EditHooks {
	/** The transport's order: refuse a changed category before the row (v1). */
	categoryFirst?: boolean;
}

export interface DeleteHooks {
	/** Runs once the delete is allowed, before any row goes: the server's snapshot. */
	beforeRemove?: (row: StoredExpense) => Promise<void>;
}

/** The rate columns of a saved row and the money it booked. */
export function savedRateOf(row: StoredExpense): SavedRate {
	return {
		currency: row.currency,
		exchangeRate: toFloat(row.exchangeRate),
		rateType: row.rateType,
		homeCurrency: row.homeCurrency,
		homeRate: row.homeRate,
		amount: row.amount,
		date: row.date,
		amountInUSD: row.amountInUSD,
		homeAmount: row.homeAmount,
	};
}

/**
 * An income or a transfer fee that moved money in an account has a leg with
 * its amount, currency and day. An edit would change the row but not the
 * leg, so the account would disagree with it: those edits are refused.
 * Title, category and notes stay editable.
 */
function refuseLegMoneyEdit(row: StoredExpense, input: EditInput): void {
	if (!row.hasLegs) return;
	const changesMoney =
		!dec(row.amount).eq(dec(String(input.amount))) ||
		row.currency !== input.currency ||
		row.date.getTime() !== input.date.getTime();
	if (changesMoney) throw new EditRefusal("badRequest", LEG_EDIT_REFUSED);
}

export interface EditResult {
	/** The row as it was read, before the edit. */
	before: StoredExpense;
	/** The row as stored after it. */
	after: StoredExpense;
}

/**
 * The flag after the category rule: a changed category must be the person's
 * expense category, same as on create; an unchanged one is left alone so
 * editing never trips on it. The form leaving the flag unset takes the new
 * category's default.
 */
async function excludeAfterCategory(
	port: ExpenseEditPort,
	input: EditInput,
	current: StoredExpense | null,
): Promise<boolean | undefined> {
	if (!input.categoryId || input.categoryId === current?.categoryId)
		return input.excludeFromAnalytics;
	const category = expenseCategory(
		await port.category(input.categoryId),
		"not_found",
	);
	return input.excludeFromAnalytics === undefined && category.excludeByDefault
		? true
		: input.excludeFromAnalytics;
}

/**
 * The category rule of an edit, alone, for a caller that must refuse a bad
 * category before something else it runs ahead of the edit (v1's stamp
 * compare). The edit applies it again, with the same answer.
 */
export async function checkEditCategory(
	port: ExpenseEditPort,
	input: EditInput,
): Promise<void> {
	await excludeAfterCategory(port, input, await port.expense(input.id));
}

export async function editExpense(
	port: ExpenseEditPort,
	input: EditInput,
	policy: EditPolicy,
	{ categoryFirst, ...hooks }: EditOptions = {},
): Promise<EditResult> {
	const found = await port.expense(input.id);
	let excludeFromAnalytics = categoryFirst
		? await excludeAfterCategory(port, input, found)
		: undefined;
	const before = reach(found, policy);
	await hooks.afterRead?.(before);
	refuseLegMoneyEdit(before, input);
	if (!categoryFirst)
		excludeFromAnalytics = await excludeAfterCategory(port, input, before);

	const amount = positiveAmount(input.amount);
	const figures = hooks.restoredFigures
		? await hooks.restoredFigures()
		: await bookSaved(port, input, amount, before);
	const amortizeOver = input.amortizeOver ?? 0;
	const after = await port.write(input.id, {
		title: input.title,
		amount,
		currency: input.currency,
		...figures,
		// Only these two keep what the row has when the form says nothing.
		pricingSource: input.pricingSource ?? undefined,
		date: input.date,
		location: input.location || null,
		description: input.description || null,
		categoryId: input.categoryId || null,
		isAmortizedParent: amortizeOver > 1,
		excludeFromAnalytics,
	});
	await hooks.afterWrite?.(after, amortizeOver);
	return { before, after };
}

/** Books the form's rate against the row as saved: no money moved keeps its figures. */
async function bookSaved(
	port: ExpenseEditPort,
	input: EditInput,
	amount: string,
	before: StoredExpense,
): Promise<SavedFigures> {
	const book = await port.rateBook();
	const saved = savedRateOf(before);
	return bookRate(
		book,
		{ amount, currency: input.currency, date: input.date },
		rateChoice(input, saved, book.homeCurrency),
		saved,
	);
}

/** Deletes an expense and, through the adapter, its spread parts. Returns the row as it was. */
export async function deleteExpense(
	port: ExpenseEditPort,
	id: string,
	policy: EditPolicy,
	hooks: DeleteHooks = {},
): Promise<StoredExpense> {
	const row = reach(await port.expense(id), policy);
	checkDeletable(row, policy);
	await hooks.beforeRemove?.(row);
	await port.remove(row);
	return row;
}
