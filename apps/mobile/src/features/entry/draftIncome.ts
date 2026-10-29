import { fromMinor, money } from "@retrospend/domain/money-minor";
import {
	amountMinor,
	DEFAULT_RATE,
	type PendingWrite,
	type RateChoice,
	rateFields,
} from "./draftAmount";

// The income composer's state and the write it becomes.

export interface IncomeDraft extends RateChoice {
	id: string;
	currency: string;
	amountText: string;
	/** Who paid you, as typed or picked. */
	source: string;
	date: string;
	usePlan: boolean;
	note: string;
}

export function newIncomeDraft(input: {
	id: string;
	currency: string;
	date: string;
	usePlan: boolean;
}): IncomeDraft {
	return { ...input, amountText: "", source: "", note: "", ...DEFAULT_RATE };
}

export type IncomeErrors = Partial<Record<"amount" | "source" | "rate", true>>;

export function incomeErrors(d: IncomeDraft, locale: string): IncomeErrors {
	const errors: IncomeErrors = {};
	if (!amountMinor(d.amountText, locale, d.currency)) errors.amount = true;
	if (!d.source.trim()) errors.source = true;
	if (rateFields(d, locale) === null) errors.rate = true;
	return errors;
}

/** Add income: money in with no account, so it lands in To assign. */
export function buildIncomeWrite(
	d: IncomeDraft,
	input: { locale: string; hasBudget: boolean | null },
): PendingWrite | null {
	const minor = amountMinor(d.amountText, input.locale, d.currency);
	const source = d.source.trim();
	const rate = rateFields(d, input.locale);
	if (!minor || !source || !rate) return null;
	const note = d.note.trim();
	return {
		entity: "income",
		label: source,
		body: {
			id: d.id,
			title: source,
			amount: fromMinor(money(minor, d.currency)),
			currency: d.currency,
			date: d.date,
			...rate,
			...(note ? { description: note } : {}),
			// Without an envelope budget there is no plan to use.
			usePlan: d.usePlan && input.hasBudget === true,
		},
	};
}
