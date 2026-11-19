/**
 * Creating an expense, for the server (createExpenseIn) and the device
 * (engine createExpense): one core, two adapters that load the rates. The
 * caller resolves the category through expenseCategory first, so the refusal
 * order is the same everywhere: category, amount above 0, then the rate
 * (a missing rate throws MissingRateError, never 1).
 */
import { dec } from "../precise-decimal";
import {
	type BookContext,
	type BookedRate,
	bookRate,
	type RateInput,
	rateChoice,
	storedAmount,
} from "../rate-booking";
import type { CategoryFacts } from "./category";
import { AmountRefusedError } from "./refusals";

export interface CreateRulesInput {
	/** Decimal text or a number; never read through a float. */
	amount: number | string;
	projectId?: string | null;
	excludeFromAnalytics?: boolean;
}

export interface CreatePlan {
	/** As the column stores it: 8 decimals, half to even, above 0. */
	amount: string;
	excludeFromAnalytics: boolean;
}

export function planCreate(
	input: CreateRulesInput,
	category?: CategoryFacts,
): CreatePlan {
	let amount: string;
	try {
		amount = storedAmount(input.amount);
	} catch {
		throw new AmountRefusedError();
	}
	// An amount that stores as 0 (0.000000001) is no expense either.
	if (!dec(amount).gt(0)) throw new AmountRefusedError();
	return {
		amount,
		// A project's expenses always count; otherwise the form, then the category.
		excludeFromAnalytics: input.projectId
			? false
			: (input.excludeFromAnalytics ?? category?.excludeByDefault ?? false),
	};
}

export interface CreateInput extends RateInput, CreateRulesInput {}

/** The plan and both legs of the rate, booked once at the stored amount. */
export async function bookCreate(
	book: BookContext,
	input: CreateInput,
	category?: CategoryFacts,
): Promise<{ plan: CreatePlan; booked: BookedRate }> {
	const plan = planCreate(input, category);
	const booked = await bookRate(
		book,
		{ amount: plan.amount, currency: input.currency, date: input.date },
		rateChoice(input, null, book.homeCurrency),
	);
	return { plan, booked };
}
