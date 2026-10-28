import { fromMinorUnits, toMinorUnits } from "@retrospend/domain/money";
import { fromMinor, money } from "@retrospend/domain/money-minor";
import { draftFromMinor, parseMoneyInput } from "@retrospend/domain/parse";
import { resolveSplits } from "@retrospend/domain/shared-split-computation";
import {
	type EntryCatalog,
	type EntryPerson,
	type EntryPlace,
	personKey,
} from "./types";

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
	/** The project it goes into; it makes the expense a shared one. */
	projectId: string | null;
	/** The project's people on that day (you left out), for people the catalog lacks. */
	projectPeople: EntryPerson[];
	/** Set when the composer edits a saved expense; null when it adds one. */
	editing: ExpenseEdit | null;
}

/**
 * What an edit keeps of the saved expense. The server replaces every field
 * of an expense, so what the composer has no field for goes back as it was.
 */
export interface ExpenseEdit {
	currency: string;
	rateType: string | null;
	location: string | null;
	description: string | null;
	amortizeOver: number | null;
	excludeFromAnalytics: boolean;
}

export interface TransferDraft {
	/** The new transfer's id, made once per composer. */
	id: string;
	fromId: string | null;
	toId: string | null;
	/** What leaves the first account, in its currency. */
	amountText: string;
	/** Exchange only: what arrived. Empty: the server books the reference rate. */
	receivedText: string;
	note: string;
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
	entity: "expenses" | "shared-expenses" | "income" | "transfers";
	/** An edit of a saved expense is sent at once, never queued. */
	kind?: "create" | "update";
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
		projectId: null,
		projectPeople: [],
		editing: null,
	};
}

/** The saved entry (GET /expenses/{id}) as the composer's draft. */
export function expenseFromEntry(
	entry: {
		id: string;
		title: string;
		amount: { minor: number; currency: string };
		rateType: string | null;
		date: string;
		categoryId: string | null;
		location: string | null;
		description: string | null;
		amortizeOver: number | null;
		excludeFromAnalytics: boolean;
	},
	locale: string,
): ExpenseDraft {
	const { currency } = entry.amount;
	return {
		id: entry.id,
		currency,
		amountText: draftFromMinor(Math.abs(entry.amount.minor), locale, currency),
		title: entry.title,
		categoryId: entry.categoryId,
		withKeys: [],
		date: entry.date,
		projectId: null,
		projectPeople: [],
		editing: {
			currency,
			rateType: entry.rateType,
			location: entry.location,
			description: entry.description,
			amortizeOver: entry.amortizeOver,
			excludeFromAnalytics: entry.excludeFromAnalytics,
		},
	};
}

export function newTransferDraft(input: {
	id: string;
	date: string;
	currency: string;
	places: EntryPlace[];
}): TransferDraft {
	// From: an account in the currency you usually spend in; To: another one.
	const from =
		input.places.find((p) => p.currency === input.currency) ?? input.places[0];
	const to = input.places.find((p) => p.id !== from?.id);
	return {
		id: input.id,
		fromId: from?.id ?? null,
		toId: to?.id ?? null,
		amountText: "",
		receivedText: "",
		note: "",
		date: input.date,
	};
}

/** The people a split can name: the catalog's, plus the project's own. */
export function knownPeople(
	d: Pick<ExpenseDraft, "projectPeople">,
	catalogPeople: EntryPerson[],
): EntryPerson[] {
	const seen = new Set(catalogPeople.map(personKey));
	return [
		...catalogPeople,
		...d.projectPeople.filter((p) => !seen.has(personKey(p))),
	];
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
	if (d.editing) return null;
	if (d.withKeys.length === 0 && !d.projectId) {
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
	const people = knownPeople(d, input.catalog.people);
	const others = d.withKeys.flatMap((key) => {
		const p = people.find((x) => personKey(x) === key);
		return p ? [{ type: p.type, id: p.id }] : [];
	});
	// A project can hold an expense of yours alone; any other split needs someone.
	if (others.length === 0 && !d.projectId) return null;
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
			...(d.projectId ? { projectId: d.projectId } : {}),
		},
	};
}

/**
 * The request that saves an edit: PUT /expenses/{id}, every field sent.
 * What the composer does not show (place, notes, spread, left out of
 * insights) goes back as it was; the rate type only while the currency is
 * still the saved one.
 */
export function buildExpenseUpdate(
	d: ExpenseDraft,
	input: { locale: string; catalog: EntryCatalog },
): PendingWrite | null {
	const { editing } = d;
	const minor = amountMinor(d.amountText, input.locale, d.currency);
	const category = input.catalog.categories.find((c) => c.id === d.categoryId);
	if (!editing || !minor || !category) return null;
	const title = d.title.trim() || category.name;
	return {
		entity: "expenses",
		kind: "update",
		label: title,
		body: {
			id: d.id,
			title,
			amount: fromMinor(money(minor, d.currency)),
			currency: d.currency,
			date: d.date,
			categoryId: category.id,
			excludeFromAnalytics: editing.excludeFromAnalytics,
			...(editing.rateType && editing.currency === d.currency
				? { rateType: editing.rateType }
				: {}),
			...(editing.location ? { location: editing.location } : {}),
			...(editing.description ? { description: editing.description } : {}),
			...(editing.amortizeOver ? { amortizeOver: editing.amortizeOver } : {}),
		},
	};
}

export type TransferErrors = Partial<
	Record<"amount" | "same" | "places", true>
>;

/** The place a transfer leaves from, with its currency (the amount's). */
export function transferCurrencies(
	d: TransferDraft,
	places: EntryPlace[],
): { from: string | null; to: string | null } {
	return {
		from: places.find((p) => p.id === d.fromId)?.currency ?? null,
		to: places.find((p) => p.id === d.toId)?.currency ?? null,
	};
}

export function transferErrors(
	d: TransferDraft,
	input: { locale: string; places: EntryPlace[] },
): TransferErrors {
	const errors: TransferErrors = {};
	const { from } = transferCurrencies(d, input.places);
	if (!d.fromId || !d.toId) errors.places = true;
	else if (d.fromId === d.toId) errors.same = true;
	if (!from || !amountMinor(d.amountText, input.locale, from)) {
		errors.amount = true;
	}
	return errors;
}

/**
 * Move money between two of your accounts. Two currencies make it an
 * exchange: what arrived is optional, and the server books the reference
 * rate for a side left empty.
 */
export function buildTransferWrite(
	d: TransferDraft,
	input: { locale: string; places: EntryPlace[] },
): PendingWrite | null {
	if (Object.keys(transferErrors(d, input)).length > 0) return null;
	const { from, to } = transferCurrencies(d, input.places);
	if (!from || !to) return null;
	const out = amountMinor(d.amountText, input.locale, from);
	if (!out) return null;
	const received =
		from === to ? null : amountMinor(d.receivedText, input.locale, to);
	const note = d.note.trim();
	const fromName = input.places.find((p) => p.id === d.fromId)?.name ?? "";
	const toName = input.places.find((p) => p.id === d.toId)?.name ?? "";
	return {
		entity: "transfers",
		label: `${fromName} > ${toName}`,
		body: {
			id: d.id,
			fromAccountId: d.fromId,
			toAccountId: d.toId,
			fromCurrency: from,
			toCurrency: to,
			fromAmount: fromMinor(money(out, from)),
			...(received ? { toAmount: fromMinor(money(received, to)) } : {}),
			date: d.date,
			...(note ? { note } : {}),
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
