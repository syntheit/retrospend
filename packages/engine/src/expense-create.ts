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
 * - Sign, length and day parsing are the transport's: like createExpenseIn
 *   this books any finite amount, negative ones sign-symmetrically.
 *
 * Run it through LocalDb.write, which returns the undo token (a revert that
 * deletes the row), or LocalDb.preview, which is the same code rolled back.
 */
import {
	pickBestRate,
	rateRowsByCurrency,
	rateWindow,
} from "@retrospend/domain/money";
import { dec } from "@retrospend/domain/precise-decimal";
import {
	bookRate,
	CURRENCY_KEY,
	parseRateDefaults,
	preferredRateType,
	type RateFinder,
	RateInputError,
	rateChoice,
	storedAmount,
} from "@retrospend/domain/rate-booking";
import type { ExpenseRow } from "./expenses";
import type { WriteFn } from "./local-db";
import { InvalidInputError, type TableRows } from "./port";

export const EXPENSE_CREATE = "expense.create";

/** A category the caller resolved: only an expense category can hold an expense. */
export interface ExpenseCategory {
	id: string;
	kind: string;
	excludeByDefault: boolean;
}

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

/** bookRate and rateChoice reject bad input with the domain's error; the port's is InvalidInputError. */
async function refusing<T>(run: () => T | Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (e) {
		if (e instanceof RateInputError) throw new InvalidInputError(e.message);
		throw e;
	}
}

function parseAmount(amount: number | string) {
	let value: ReturnType<typeof dec> | undefined;
	try {
		value = dec(amount);
	} catch {
		// Falls through to the refusal below.
	}
	if (!value?.isFinite()) throw new InvalidInputError("Enter an amount");
	return value;
}

/** The write function for `input`; pass it to LocalDb.write or LocalDb.preview. */
export function createExpense(input: CreateExpenseInput): WriteFn<ExpenseRow> {
	return async (r) => {
		if (!CURRENCY_KEY.test(input.currency))
			throw new InvalidInputError(`Unknown currency ${input.currency}`);
		if (Number.isNaN(input.date.getTime()))
			throw new InvalidInputError("Pick a valid date");
		if ((input.amortizeOver ?? 0) > 1)
			throw new InvalidInputError("Spreading an expense is not on the device");
		if (input.category && input.category.kind !== "EXPENSE")
			throw new InvalidInputError("Category not found");
		// Stored and booked at the column's 8 decimals, half to even, as the server does.
		const amount = storedAmount(parseAmount(input.amount).toFixed());

		const settings = r.settings.require();
		const booked = await refusing(() =>
			bookRate(
				{
					homeCurrency: settings.homeCurrency,
					preferred: preferredRateType(
						settings.homeCurrency,
						parseRateDefaults(settings.defaultRateTypes),
					),
					find: finderOf(r.rates.list()),
				},
				{ amount, currency: input.currency, date: input.date },
				rateChoice(input, null, settings.homeCurrency),
			),
		);

		const row: ExpenseRow = {
			id: input.id,
			status: "FINALIZED",
			direction: "OUT",
			entryKind: "STANDARD",
			inType: null,
			isAmortizedParent: false,
			// A project's expenses always count; otherwise the form, then the category.
			excludeFromAnalytics: input.projectId
				? false
				: (input.excludeFromAnalytics ??
					input.category?.excludeByDefault ??
					false),
			categoryKind: input.category?.kind ?? null,
			categoryId: input.category?.id ?? null,
			date: new Date(input.date.getTime()),
			currency: input.currency,
			amount,
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
		};
		r.expenses.create({ expense: row, shares: [] });
		return row;
	};
}
