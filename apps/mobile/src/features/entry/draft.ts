import { fromMinor, money } from "@retrospend/domain/money-minor";
import { parseMoneyInput } from "@retrospend/domain/parse";
import { resolveSplits } from "@retrospend/domain/shared-split-computation";
import { fromMinorUnits, toMinorUnits } from "@retrospend/domain/money";
import { type EntryCatalog, type EntryPerson, personKey } from "./types";

// The composers' state as plain data, and the pure steps on it: what the
// keypad typed, which write it becomes, and the equal split shown before
// Save. The server books every rate and resolves every split again; nothing
// here decides a number the server owns.

export interface ExpenseDraft {
	/** The new expense's id, made once per composer: a second tap cannot write twice. */
	id: string;
	currency: string;
	/** The keypad's text, formatted by the domain package. */
	amountText: string;
	title: string;
	categoryId: string | null;
	/** Person keys of the others on it. Empty: a personal expense. */
	withKeys: string[];
	/** The day, "yyyy-MM-dd". */
	date: string;
}

export interface IncomeDraft {
	id: string;
	currency: string;
	amountText: string;
	/** Who paid you, as typed or picked. */
	source: string;
	date: string;
	usePlan: boolean;
}

/** A write waiting for the outbox: the v1 collection and the request body. */
export interface PendingWrite {
	entity: "expenses" | "shared-expenses" | "income";
	body: Record<string, unknown>;
	/** What the toast calls it: the title, or the source. */
	label: string;
}

export function newExpenseDraft(input: {
	id: string;
	currency: string;
	date: string;
}): ExpenseDraft {
	return {
		...input,
		amountText: "",
		title: "",
		categoryId: null,
		withKeys: [],
		date: input.date,
	};
}

export function newIncomeDraft(input: {
	id: string;
	currency: string;
	date: string;
	usePlan: boolean;
}): IncomeDraft {
	return { ...input, amountText: "", source: "" };
}

/** The amount in minor units, or null until the keypad text reads as an amount. */
export function amountMinor(
	text: string,
	locale: string,
	currency: string,
): number | null {
	const read = parseMoneyInput(text, locale, currency);
	return read.ok ? read.minor : null;
}

export type ExpenseErrors = Partial<Record<"amount" | "category", true>>;

export function expenseErrors(d: ExpenseDraft, locale: string): ExpenseErrors {
	const errors: ExpenseErrors = {};
	if (!amountMinor(d.amountText, locale, d.currency)) errors.amount = true;
	if (!d.categoryId) errors.category = true;
	return errors;
}

export type IncomeErrors = Partial<Record<"amount" | "source", true>>;

export function incomeErrors(d: IncomeDraft, locale: string): IncomeErrors {
	const errors: IncomeErrors = {};
	if (!amountMinor(d.amountText, locale, d.currency)) errors.amount = true;
	if (!d.source.trim()) errors.source = true;
	return errors;
}

export interface SplitRow {
	key: string;
	name: string;
	person: EntryPerson | null;
	/** Their share in the expense's currency, in minor units. */
	minor: number;
}

const YOU = "you";

/**
 * The equal split among you and the people picked, with the leftover minor
 * units where the server puts them (the payer first). Rows are you, then the
 * others in the order picked. Empty for a personal expense.
 */
export function splitRows(
	d: ExpenseDraft,
	input: {
		locale: string;
		meId: string;
		people: EntryPerson[];
		youLabel: string;
	},
): SplitRow[] {
	const total = amountMinor(d.amountText, input.locale, d.currency);
	if (d.withKeys.length === 0 || !total) return [];
	const others = d.withKeys
		.map((key) => input.people.find((p) => personKey(p) === key))
		.filter((p): p is EntryPerson => p !== undefined);
	const you = { participantType: "user" as const, participantId: input.meId };
	const resolved = resolveSplits({
		mode: "EQUAL",
		amount: fromMinorUnits(total, d.currency),
		currency: d.currency,
		participants: [
			you,
			...others.map((p) => ({
				participantType: p.type,
				participantId: p.id,
			})),
		],
		paidBy: you,
	});
	return resolved.map((row, i) => {
		const person = i === 0 ? null : (others[i - 1] ?? null);
		return {
			key:
				i === 0
					? YOU
					: personKey({ type: row.participantType, id: row.participantId }),
			name: person?.name ?? input.youLabel,
			person,
			minor: toMinorUnits(row.shareAmount, d.currency),
		};
	});
}

/**
 * The request for Save, or null while it cannot be saved. A split goes to
 * /shared-expenses with you as the payer, an expense alone to /expenses.
 * An empty title saves as the category's name, as on the web.
 */
export function buildExpenseWrite(
	d: ExpenseDraft,
	input: {
		locale: string;
		meId: string;
		catalog: EntryCatalog;
	},
): PendingWrite | null {
	const minor = amountMinor(d.amountText, input.locale, d.currency);
	const category = input.catalog.categories.find((c) => c.id === d.categoryId);
	if (!minor || !category) return null;
	const title = d.title.trim() || category.name;
	const amount = fromMinor(money(minor, d.currency));
	if (d.withKeys.length === 0) {
		return {
			entity: "expenses",
			label: title,
			body: {
				id: d.id,
				title,
				amount,
				currency: d.currency,
				date: d.date,
				categoryId: category.id,
			},
		};
	}
	const others = d.withKeys.flatMap((key) => {
		const p = input.catalog.people.find((x) => personKey(x) === key);
		return p ? [{ type: p.type, id: p.id }] : [];
	});
	if (others.length === 0) return null;
	const you = { type: "user" as const, id: input.meId };
	return {
		entity: "shared-expenses",
		label: title,
		body: {
			id: d.id,
			description: title,
			amount,
			currency: d.currency,
			date: d.date,
			categoryId: category.id,
			paidBy: you,
			splitMode: "EQUAL",
			splitWith: [you, ...others],
		},
	};
}

/** Add income: money in with no account, so it lands in To assign. */
export function buildIncomeWrite(
	d: IncomeDraft,
	input: { locale: string; hasBudget: boolean | null },
): PendingWrite | null {
	const minor = amountMinor(d.amountText, input.locale, d.currency);
	const source = d.source.trim();
	if (!minor || !source) return null;
	return {
		entity: "income",
		label: source,
		body: {
			id: d.id,
			title: source,
			amount: fromMinor(money(minor, d.currency)),
			currency: d.currency,
			date: d.date,
			// Without an envelope budget there is no plan to use.
			usePlan: d.usePlan && input.hasBudget === true,
		},
	};
}
