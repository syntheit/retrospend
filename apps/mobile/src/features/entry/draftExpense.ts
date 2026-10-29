import { fromMinor, money } from "@retrospend/domain/money-minor";
import { draftFromMinor } from "@retrospend/domain/parse";
import {
	amountMinor,
	DEFAULT_RATE,
	type PendingWrite,
	type RateChoice,
	rateFields,
} from "./draftAmount";
import { partText, type SplitMode, shareFields } from "./splitParts";
import {
	type EntryCatalog,
	type EntryPerson,
	type PersonType,
	personKey,
} from "./types";

// The expense composer's state as plain data, and the pure steps on it: which
// write it becomes, and who the split names before Save. The server splits
// every amount (its dry run gives the shares shown); nothing here decides a
// number the server owns.

export interface ExpenseDraft extends RateChoice {
	/** The new expense's id, made once per composer: a second tap cannot write twice. */
	id: string;
	currency: string;
	/** The keypad's text, formatted by the domain package. */
	amountText: string;
	title: string;
	categoryId: string | null;
	/** Person keys of the others on it. Empty: a personal expense. */
	withKeys: string[];
	/** Who paid, as a person key; null: you. Only people on the split can pay. */
	paidByKey: string | null;
	/** How it divides. */
	splitMode: SplitMode;
	/** What each person typed in a custom split, by person key. */
	parts: Record<string, string>;
	/** An edit changed who paid, the mode or a part: only then the people are sent back. */
	splitTouched: boolean;
	/** The day, "yyyy-MM-dd". */
	date: string;
	/** The project it goes into; it makes the expense a shared one. */
	projectId: string | null;
	/** The project's people on that day (you left out), for people the catalog lacks. */
	projectPeople: EntryPerson[];
	/** A place, for a personal expense. */
	location: string;
	/** The note (a split expense's notes). */
	note: string;
	/** Months a personal expense is spread over; null when it is one-time. */
	spread: number | null;
	/** Left out of reports and Insights (a personal expense). */
	exclude: boolean;
	/** The person flipped Exclude; a category no longer sets it. */
	excludeTouched: boolean;
	/** Exclude is on because the category starts its expenses excluded. */
	excludeAuto: boolean;
	/** Set when the composer edits a saved expense; null when it adds one. */
	editing: ExpenseEdit | null;
}

/** The months a spread can take; a saved odd one is offered too. */
export const SPREAD_MONTHS = [2, 3, 6, 12, 24] as const;
export const NOTE_LIMIT = 1000;
export const SHARED_NOTE_LIMIT = 5000;
export const LOCATION_LIMIT = 191;

/**
 * What an edit keeps of a saved split: who paid and how it is split. The
 * people are the server's to keep (the edit leaves them out).
 */
export interface SavedSplit {
	mode: SplitMode;
	paidBy: { type: PersonType; id: string };
	/** You hold a share of it; a payer for others may hold none. */
	youOnSplit: boolean;
}

/**
 * What an edit keeps of the saved expense. The server replaces every field
 * of an expense, so what the composer has no field for goes back as it was:
 * the rate type of a personal expense, the split and the project of a
 * shared one, and its category when it is someone else's (a project
 * organizer editing another person's split).
 */
export interface ExpenseEdit {
	source: "personal" | "shared";
	currency: string;
	rateType: string | null;
	/** The saved expense's value at home: shown while its custom rate is kept. */
	home: { minor: number; currency: string } | null;
	split: SavedSplit | null;
	/** The project it is in; an edit never moves it out. */
	projectId: string | null;
	/** The saved category, which may not be in your catalog. */
	category: { id: string; name: string } | null;
}

const NO_SPLIT = {
	paidByKey: null,
	splitMode: "EQUAL" as SplitMode,
	parts: {},
	splitTouched: false,
};

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
		...NO_SPLIT,
		date: input.date,
		projectId: null,
		projectPeople: [],
		location: "",
		note: "",
		spread: null,
		exclude: false,
		excludeTouched: false,
		excludeAuto: false,
		...DEFAULT_RATE,
		editing: null,
	};
}

/** The saved entry (GET /expenses/{id}) as the composer's draft. */
export function expenseFromEntry(
	entry: {
		id: string;
		title: string;
		amount: { minor: number; currency: string };
		home?: { minor: number; currency: string } | null;
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
		...NO_SPLIT,
		date: entry.date,
		projectId: null,
		projectPeople: [],
		location: entry.location ?? "",
		note: entry.description ?? "",
		spread: entry.amortizeOver,
		exclude: entry.excludeFromAnalytics,
		// A saved choice stays the person's, whatever the category says.
		excludeTouched: true,
		excludeAuto: false,
		// The saved type starts picked; a saved custom rate is kept as "custom".
		...DEFAULT_RATE,
		rateType: entry.rateType,
		editing: {
			source: "personal",
			currency,
			rateType: entry.rateType,
			home: entry.home ?? null,
			split: null,
			projectId: null,
			category: null,
		},
	};
}

type Person = { type: PersonType; id: string };

/** The saved split expense (GET /shared-expenses/{id}) as the composer's draft. */
export function sharedFromDetail(
	detail: {
		id: string;
		title: string;
		amount: { minor: number; currency: string };
		date: string;
		notes: string | null;
		splitMode: SavedSplit["mode"];
		project: { id: string } | null;
		category: { id: string; name: string } | null;
		paidBy: Person & { name?: string; imageUrl?: string | null };
		splits?: (Person & {
			name?: string;
			imageUrl?: string | null;
			share: { minor: number; currency: string };
			percentage: string | null;
			units: number | null;
		})[];
	},
	locale: string,
	meId = "",
): ExpenseDraft {
	const { currency } = detail.amount;
	const isMe = (p: Person) => p.type === "user" && p.id === meId;
	const splits = detail.splits ?? [];
	const others = splits.filter((s) => !isMe(s));
	const payer = detail.paidBy;
	const payerKey = isMe(payer) ? null : personKey(payer);
	// Everyone the split names, so a saved payer with no share stays pickable.
	const named = [...others, ...(payerKey ? [payer] : [])].filter(
		(p, i, all) => all.findIndex((q) => personKey(q) === personKey(p)) === i,
	);
	return {
		id: detail.id,
		currency,
		amountText: draftFromMinor(Math.abs(detail.amount.minor), locale, currency),
		title: detail.title,
		categoryId: detail.category?.id ?? null,
		withKeys: others.map(personKey),
		paidByKey: payerKey,
		splitMode: detail.splitMode,
		parts: Object.fromEntries(
			splits.map((s) => [personKey(s), partText(detail.splitMode, s, locale)]),
		),
		splitTouched: false,
		date: detail.date,
		projectId: detail.project?.id ?? null,
		projectPeople: named.map((p) => ({
			type: p.type,
			id: p.id,
			name: p.name ?? "",
			imageUrl: p.imageUrl ?? null,
		})),
		location: "",
		note: detail.notes ?? "",
		spread: null,
		exclude: false,
		excludeTouched: false,
		excludeAuto: false,
		...DEFAULT_RATE,
		editing: {
			source: "shared",
			currency,
			rateType: null,
			home: null,
			split: {
				mode: detail.splitMode,
				paidBy: { type: payer.type, id: payer.id },
				youOnSplit: splits.length === 0 || splits.some(isMe),
			},
			projectId: detail.project?.id ?? null,
			category: detail.category
				? { id: detail.category.id, name: detail.category.name }
				: null,
		},
	};
}

/** Whether Spread over and Exclude apply: a personal expense, not a split. */
export function isPersonal(d: ExpenseDraft): boolean {
	if (d.editing) return d.editing.source === "personal";
	return d.withKeys.length === 0 && !d.projectId;
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

export type ExpenseErrors = Partial<
	Record<"amount" | "category" | "rate" | "split", true>
>;

/** Whether the draft is a split that sends its people (a new split, or an edit that changed it). */
function sendsSplit(d: ExpenseDraft): boolean {
	if (d.editing) return d.editing.source === "shared" && d.splitTouched;
	return d.withKeys.length > 0 || d.projectId !== null;
}

/** You hold a share, unless an edit of someone's split says you do not. */
function youOnSplit(d: ExpenseDraft): boolean {
	return d.editing ? (d.editing.split?.youOnSplit ?? true) : true;
}

/** Whether every person of a custom split has a part that reads. */
function partsRead(d: ExpenseDraft, locale: string, meId: string): boolean {
	if (d.splitMode === "EQUAL") return true;
	const mode = d.splitMode;
	const keys = [
		...(youOnSplit(d) ? [personKey({ type: "user", id: meId })] : []),
		...d.withKeys,
	];
	return keys.every(
		(key) => shareFields(mode, d.parts[key] ?? "", locale, d.currency) !== null,
	);
}

/**
 * What keeps Save from writing. A category must be one of `categories`, or
 * the one an edit started with (someone else's, on their split).
 */
export function expenseErrors(
	d: ExpenseDraft,
	locale: string,
	categories?: { id: string }[],
	meId?: string,
): ExpenseErrors {
	const errors: ExpenseErrors = {};
	if (!amountMinor(d.amountText, locale, d.currency)) errors.amount = true;
	const known =
		!categories ||
		categories.some((c) => c.id === d.categoryId) ||
		d.editing?.category?.id === d.categoryId;
	if (!d.categoryId || !known) errors.category = true;
	if (rateFields(d, locale) === null) errors.rate = true;
	if (meId !== undefined && sendsSplit(d) && !partsRead(d, locale, meId)) {
		errors.split = true;
	}
	return errors;
}

/**
 * Picking a category: one that starts its expenses excluded turns Exclude on
 * (and another turns it off again), until the person flips it, as on the web.
 */
export function pickCategory(
	d: Pick<ExpenseDraft, "excludeTouched">,
	category: { id: string; excludeByDefault?: boolean } | undefined,
	id: string,
): Partial<ExpenseDraft> {
	if (d.excludeTouched || !category) return { categoryId: id };
	const auto = category.excludeByDefault === true;
	return { categoryId: id, exclude: auto, excludeAuto: auto };
}

export interface SplitRow {
	key: string;
	name: string;
	person: EntryPerson | null;
	/** Their share as the server's dry run splits it; null until it answers. */
	share: { minor: number; currency: string } | null;
}

const YOU = "you";

/**
 * Who shares the expense: you, then the others in the order picked, each
 * with the share the server's dry run gives them (`shares`, null until it
 * answers). Nothing here splits an amount. Empty for a personal expense.
 */
export function splitRows(
	d: ExpenseDraft,
	input: {
		locale: string;
		meId: string;
		people: EntryPerson[];
		youLabel: string;
		shares:
			| { key: string; share: { minor: number; currency: string } }[]
			| null;
	},
): SplitRow[] {
	const total = amountMinor(d.amountText, input.locale, d.currency);
	if (d.withKeys.length === 0 || !total) return [];
	const others = d.withKeys
		.map((key) => input.people.find((p) => personKey(p) === key))
		.filter((p): p is EntryPerson => p !== undefined);
	const shareOf = (key: string) =>
		input.shares?.find((s) => s.key === key)?.share ?? null;
	return [
		{
			key: YOU,
			name: input.youLabel,
			person: null,
			share: shareOf(personKey({ type: "user", id: input.meId })),
		},
		...others.map((person) => ({
			key: personKey(person),
			name: person.name,
			person,
			share: shareOf(personKey(person)),
		})),
	];
}

/**
 * The request for Save, or null while it cannot be saved. A split goes to
 * /shared-expenses with its payer and mode (you and equal unless picked), an
 * expense alone to /expenses.
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
		const rate = rateFields(d, input.locale);
		if (!rate) return null;
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
				...rate,
				...personalDetails(d),
			},
		};
	}
	const split = splitBody(d, input);
	// A project can hold an expense of yours alone; any other split needs someone.
	if (!split || (split.others === 0 && !d.projectId)) return null;
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
			paidBy: split.paidBy,
			splitMode: d.splitMode,
			splitWith: split.splitWith,
			...sharedNotes(d),
			...(d.projectId ? { projectId: d.projectId } : {}),
		},
	};
}

type Ref = { type: PersonType; id: string };

/**
 * Who paid and who shares, as the API takes them. A custom split names each
 * person's typed part (the server splits and checks the total); null while a
 * part does not read. The payer is you unless another person on the split was
 * picked (an edit also keeps a saved payer who holds no share).
 */
function splitBody(
	d: ExpenseDraft,
	input: { locale: string; meId: string; catalog: EntryCatalog },
): {
	paidBy: Ref;
	splitWith: Record<string, unknown>[];
	others: number;
} | null {
	const people = knownPeople(d, input.catalog.people);
	const you: Ref = { type: "user", id: input.meId };
	const others = d.withKeys.flatMap((key) => {
		const p = people.find((x) => personKey(x) === key);
		return p ? [{ type: p.type, id: p.id }] : [];
	});
	const members = [...(youOnSplit(d) ? [you] : []), ...others];
	// A new split is paid by someone on it; an edit may keep a payer with no share.
	const payerKey =
		d.paidByKey !== null && (d.editing || d.withKeys.includes(d.paidByKey))
			? d.paidByKey
			: null;
	const payer =
		payerKey === null
			? you
			: (people.find((x) => personKey(x) === payerKey) ?? you);
	const paidBy = { type: payer.type, id: payer.id };
	const mode = d.splitMode;
	if (mode === "EQUAL") {
		return { paidBy, splitWith: members, others: others.length };
	}
	const splitWith: Record<string, unknown>[] = [];
	for (const member of members) {
		const fields = shareFields(
			mode,
			d.parts[personKey(member)] ?? "",
			input.locale,
			d.currency,
		);
		if (!fields) return null;
		splitWith.push({ ...member, ...fields });
	}
	return { paidBy, splitWith, others: others.length };
}

/**
 * What only a personal expense carries: place, note, the months it is spread
 * over, and whether it is left out of insights. An empty one is left out of
 * the body (on an edit that clears it: the server replaces every field).
 */
function personalDetails(d: ExpenseDraft) {
	const location = d.location.trim();
	const note = d.note.trim();
	return {
		...(location ? { location } : {}),
		...(note ? { description: note } : {}),
		...(d.spread ? { amortizeOver: d.spread } : {}),
		excludeFromAnalytics: d.exclude,
	};
}

function sharedNotes(d: ExpenseDraft) {
	const notes = d.note.trim();
	return notes ? { notes } : {};
}

/**
 * The request that saves an edit: PUT /expenses/{id} or /shared-expenses/{id},
 * every field sent. What the composer does not show goes back as it was: the
 * rate type only while the currency is still the saved one, and a split's
 * payer and mode. A split's people are left out, so the server keeps them and
 * splits a new amount again the saved way (set amounts scale in proportion);
 * the dry run names each person's share before and after. A split keeps its
 * saved project whatever the draft holds, and its saved category when it is
 * not one of yours.
 */
export function buildExpenseUpdate(
	d: ExpenseDraft,
	input: { locale: string; catalog: EntryCatalog; meId?: string },
): PendingWrite | null {
	const { editing } = d;
	const minor = amountMinor(d.amountText, input.locale, d.currency);
	const category =
		input.catalog.categories.find((c) => c.id === d.categoryId) ??
		(editing?.category && editing.category.id === d.categoryId
			? editing.category
			: undefined);
	if (!editing || !minor || !category) return null;
	const title = d.title.trim() || category.name;
	const amount = fromMinor(money(minor, d.currency));
	if (editing.source === "shared") {
		if (!editing.split) return null;
		// Untouched, the saved payer and mode go back and the people are left
		// out: the server keeps them. Changed, the whole split goes.
		let split: ReturnType<typeof splitBody> | null = null;
		if (d.splitTouched) {
			if (!input.meId) return null;
			split = splitBody(d, { ...input, meId: input.meId });
			if (!split) return null;
		}
		return {
			entity: "shared-expenses",
			kind: "update",
			label: title,
			body: {
				id: d.id,
				description: title,
				amount,
				currency: d.currency,
				date: d.date,
				categoryId: category.id,
				paidBy: split ? split.paidBy : editing.split.paidBy,
				splitMode: split ? d.splitMode : editing.split.mode,
				...(split ? { splitWith: split.splitWith } : {}),
				...sharedNotes(d),
				...(editing.projectId ? { projectId: editing.projectId } : {}),
			},
		};
	}
	// The saved type starts picked and a new currency clears it, so a kept
	// type only goes back while the currency is still the saved one.
	const rate = rateFields(d, input.locale);
	if (!rate) return null;
	return {
		entity: "expenses",
		kind: "update",
		label: title,
		body: {
			id: d.id,
			title,
			amount,
			currency: d.currency,
			date: d.date,
			categoryId: category.id,
			...personalDetails(d),
			...rate,
		},
	};
}
