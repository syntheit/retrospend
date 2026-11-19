/**
 * expense.create on the device: the write createExpenseIn makes on the server
 * (src/server/services/expense.service.ts), for everything a device knows.
 * It books both legs of the rate once from the rate table in the store, so
 * the entry never drifts with later rates, and inserts a finalized,
 * outgoing, standard expense. A missing rate throws MissingRateError, so
 * saving is blocked, never done at 0 or 1.
 *
 * Out of scope, and why:
 * - amortizeOver: the parts are child rows the port has no shape for yet;
 *   a parent with no parts would drop out of spending, so it is refused.
 * - The category lookup: the port has no categories table until M3, so the
 *   caller passes the category it resolved.
 * - The duplicate check (findDuplicateExpense) is a separate query, not part
 *   of createExpenseIn.
 * - Length and day parsing are the transport's. The amount rule is the
 *   domain's (expense-write/create.ts): above 0 once stored, as on the server.
 *
 * Run it through LocalDb.write, which returns the undo token (a revert that
 * deletes the row), or LocalDb.preview, which is the same code rolled back.
 */
import {
	type CategoryFacts,
	expenseCategory,
} from "@retrospend/domain/expense-write/category";
import { bookCreate } from "@retrospend/domain/expense-write/create";
import {
	AmountRefusedError,
	CategoryNotFoundError,
	EditRefusal,
	SPREAD_NOT_ON_DEVICE,
} from "@retrospend/domain/expense-write/refusals";
import {
	pickBestRate,
	rateRowsByCurrency,
	rateWindow,
} from "@retrospend/domain/money";
import { dec } from "@retrospend/domain/precise-decimal";
import {
	type BookContext,
	CURRENCY_KEY,
	parseRateDefaults,
	preferredRateType,
	type RateFinder,
	RateInputError,
} from "@retrospend/domain/rate-booking";
import type { ExpenseRow } from "./expenses";
import type { WriteFn } from "./local-db";
import { NotFoundError } from "./errors";
import { InvalidInputError, type TableRows } from "./port";
import type { Repos } from "./repos";

export const EXPENSE_CREATE = "expense.create";

/** A category the caller resolved: only an expense category can hold an expense. */
export type ExpenseCategory = CategoryFacts;

/** createExpenseIn's input, with the category resolved by the caller. */
export interface CreateExpenseInput {
	/** Client-generated; an id already in use throws InvalidInputError. */
	id: string;
	title: string;
	/** Decimal text or a number; never read through a float. */
	amount: number | string;
	currency: string;
	exchangeRate?: number;
	pricingSource?: string;
	rateType?: string;
	/** A typed rate: 1 `base` = `value` of the other currency. */
	customRate?: { base: string; value: string };
	date: Date;
	location?: string;
	description?: string;
	category?: ExpenseCategory;
	amortizeOver?: number;
	excludeFromAnalytics?: boolean;
	projectId?: string;
}

/** The best rate over the stored table, seeing the same window of rows the server's lookup does. */
function finderOf(rates: readonly TableRows["rates"][]): RateFinder {
	return (currency, date, preferredType) => {
		const rows = rateRowsByCurrency(rates, [currency])[currency] ?? [];
		return pickBestRate(rateWindow(rows, date), { date, preferredType });
	};
}

/** The home currency, the preferred rate type and the rate table of the store, as a write books with them. */
export function rateBookOf(r: Repos): BookContext {
	const settings = r.settings.require();
	return {
		homeCurrency: settings.homeCurrency,
		preferred: preferredRateType(
			settings.homeCurrency,
			parseRateDefaults(settings.defaultRateTypes),
		),
		find: finderOf(r.rates.list()),
	};
}

/**
 * The domain's refusals (rate input, category, amount, a row that cannot be
 * reached or changed) are the port's errors here, with the domain's words.
 */
export async function refusing<T>(run: () => T | Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (e) {
		if (e instanceof EditRefusal)
			throw e.kind === "notFound"
				? new NotFoundError(e.message)
				: new InvalidInputError(e.message);
		if (
			e instanceof RateInputError ||
			e instanceof CategoryNotFoundError ||
			e instanceof AmountRefusedError
		)
			throw new InvalidInputError(e.message);
		throw e;
	}
}

export function parseAmount(amount: number | string) {
	let value: ReturnType<typeof dec> | undefined;
	try {
		value = dec(amount);
	} catch {
		// Falls through to the refusal below.
	}
	if (!value?.isFinite()) throw new InvalidInputError("Enter an amount");
	return value;
}

/** What no device write takes: a currency code that is not one, a date that is not a day, a spread. */
export function refuseBadForm(input: {
	currency: string;
	date: Date;
	amortizeOver?: number;
}) {
	if (!CURRENCY_KEY.test(input.currency))
		throw new InvalidInputError(`Unknown currency ${input.currency}`);
	if (Number.isNaN(input.date.getTime()))
		throw new InvalidInputError("Pick a valid date");
	if ((input.amortizeOver ?? 0) > 1)
		throw new InvalidInputError(SPREAD_NOT_ON_DEVICE);
}

/** The write function for `input`; pass it to LocalDb.write or LocalDb.preview. */
export function createExpense(input: CreateExpenseInput): WriteFn<ExpenseRow> {
	return async (r) => {
		refuseBadForm(input);
		// The same rules createExpenseIn runs: category, then amount, then rate.
		const given = input.category;
		const category =
			given && (await refusing(() => expenseCategory(given, "not_found")));
		const { plan, booked } = await refusing(() =>
			bookCreate(
				rateBookOf(r),
				{ ...input, amount: parseAmount(input.amount).toFixed() },
				category,
			),
		);

		const row: ExpenseRow = {
			id: input.id,
			status: "FINALIZED",
			direction: "OUT",
			entryKind: "STANDARD",
			inType: null,
			isAmortizedParent: false,
			excludeFromAnalytics: plan.excludeFromAnalytics,
			categoryKind: input.category?.kind ?? null,
			categoryId: input.category?.id ?? null,
			date: new Date(input.date.getTime()),
			currency: input.currency,
			amount: plan.amount,
			// Booked figures are already at their columns' scale, half to even.
			amountInUSD: booked.amountInUSD,
			homeCurrency: booked.homeCurrency,
			homeAmount: booked.homeAmount,
			title: input.title,
			description: input.description ?? null,
			location: input.location ?? null,
			pricingSource: input.pricingSource ?? "MANUAL",
			exchangeRate: booked.exchangeRate,
			rateType: booked.rateType,
			homeRate: booked.homeRate,
			// No version until the server's answer names one.
			version: null,
		};
		r.expenses.create({ expense: row, shares: [] });
		return row;
	};
}
