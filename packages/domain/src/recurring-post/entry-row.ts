/**
 * The row a recurring confirm posts for a due period, for the server and a
 * device. It is today's server row exactly (money-in.service.ts
 * recurringEntryData), because changing it would move figures:
 *
 * - The amount is the template's, or the one typed for an "Amount varies" (ASK)
 *   template, stored at the column's 8 decimals, half to even.
 * - It books the due date's rate (or the paid-on day's) through `bookRate`,
 *   both legs at once. A rate that is not there throws MissingRateError; it is
 *   never 1.
 * - excludeFromAnalytics is false whatever the category's excludeByDefault: the
 *   category is not even an input here. The expense form applies that setting,
 *   a recurring post never has.
 * - pricingSource is RECURRING, the status FINALIZED, and money in is INCOME.
 *
 * The row has no title: it never sees user text. Each adapter adds the title
 * from its own store (the server from the opened name, refusing ciphertext).
 */
import {
	type BookContext,
	type BookedRate,
	bookRate,
	type RateChoice,
	storedAmount,
} from "../rate-booking";
import {
	AMOUNT_FIXED,
	AMOUNT_REQUIRED,
	RecurringInputRefusal,
} from "./refusals";

/** The template fields a posted row is built from. */
export interface EntryTemplate {
	readonly id: string;
	readonly userId: string;
	/** Decimal text, a number, or the database's Decimal. */
	readonly amount: number | { toString(): string };
	readonly currency: string;
	readonly categoryId: string | null;
	readonly nextDueDate: Date;
	readonly direction: "OUT" | "IN";
	readonly amountMode: "FIXED" | "ASK";
}

export interface EntryInput {
	/** A decimal string is stored as typed. Required for ASK, refused for FIXED. */
	readonly confirmedAmount?: number | string | null;
	/** The day it was really paid or received; the due date when omitted. */
	readonly paidOn?: Date;
	/** How the rate is chosen; the table's, at the user's preferred type, by default. */
	readonly choice?: RateChoice;
}

/** The posted row without its title; ids and numbers as the expense table stores them. */
export interface RecurringEntryRow extends BookedRate {
	readonly userId: string;
	readonly amount: string;
	readonly currency: string;
	readonly date: Date;
	readonly categoryId: string | null;
	readonly pricingSource: "RECURRING";
	readonly recurringTemplateId: string;
	readonly status: "FINALIZED";
	readonly direction: "OUT" | "IN";
	readonly inType: "INCOME" | null;
	readonly excludeFromAnalytics: false;
}

export async function recurringEntryRow(
	template: EntryTemplate,
	input: EntryInput,
	book: BookContext,
): Promise<RecurringEntryRow> {
	const bookedOn = input.paidOn ?? template.nextDueDate;
	const confirmed = input.confirmedAmount ?? undefined;
	const asks = template.amountMode === "ASK";
	if (asks !== (confirmed !== undefined))
		throw asks
			? new RecurringInputRefusal("amount_required", AMOUNT_REQUIRED)
			: new RecurringInputRefusal("amount_fixed", AMOUNT_FIXED);
	const given = confirmed ?? template.amount;
	const amount = storedAmount(
		typeof given === "object" ? given.toString() : given,
	);
	const rate = await bookRate(
		book,
		{ amount, currency: template.currency, date: bookedOn },
		input.choice ?? { kind: "table", rateType: null },
	);
	const isIncome = template.direction === "IN";
	return {
		userId: template.userId,
		amount,
		currency: template.currency,
		date: bookedOn,
		categoryId: template.categoryId,
		...rate,
		pricingSource: "RECURRING",
		recurringTemplateId: template.id,
		status: "FINALIZED",
		direction: isIncome ? "IN" : "OUT",
		inType: isIncome ? "INCOME" : null,
		excludeFromAnalytics: false,
	};
}
