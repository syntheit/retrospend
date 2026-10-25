/**
 * Needs you (IMPLEMENTATION §1.4, §5 2E.2; kit `RS.derive.needsYou`): ONE
 * ordered list of what waits for the viewer. Home shows it, and the nav
 * badges of People, Activity and Budget are its counts per group. The
 * server sends facts (type, entity, people, amount, date, action ids); the
 * client builds each sentence from them and formats every amount (R9, R10).
 */
import type { Money } from "@retrospend/domain/money-minor";

/** The destination an item feeds; nav badges count items per group. */
export type NeedsYouGroup = "people" | "activity" | "budget" | "setup";

export const NEEDS_YOU_GROUPS: readonly NeedsYouGroup[] = [
	"people",
	"activity",
	"budget",
	"setup",
];

/** `user:<id>`, `guest:<id>` or `shadow:<id>`, claimed shadows folded into their user. */
export type PersonKey = string;

/** YYYY-MM-DD in the viewer's calendar. */
export type IsoDate = string;

/**
 * Every item type the spec names: the people and activity prompts of the
 * kit ledger, budget SPEC §5.14 (14 types) and the new-user setup prompts
 * of the Home mockup. Types not produced yet are listed in SEAMS
 * (catalog.ts) with what they wait for; today none is.
 */
export type NeedsYouType =
	| "payment.confirm"
	| "split.review"
	| "split.rejected"
	| "split.fixRequested"
	| "recurring.overdue"
	| "recurring.due"
	| "import.review"
	| "budget.giveJob"
	| "budget.overAssigned"
	| "budget.overspent"
	| "budget.billDue"
	| "budget.debtDue"
	| "budget.sharesNeedEnvelope"
	| "budget.monthSummary"
	| "budget.monthChanged"
	| "budget.startingMoney"
	| "people.owedAging"
	| "budget.missingRate"
	| "budget.hiddenReview"
	| "budget.reconcile"
	| "setup.firstExpense"
	| "setup.homeCurrency"
	| "setup.verifyEmail"
	| "setup.importStatement";

/** What an item points at; the client opens its sheet or page. */
export type NeedsYouEntityKind =
	| "payment"
	| "sharedExpense"
	| "recurring"
	| "importJob"
	| "envelope"
	| "book"
	| "user"
	/** A person key (`user:<id>`, `shadow:<id>`, `guest:<id>`): Remind or Forgive acts on them. */
	| "person";

/**
 * An action the item supports, by entity and id. Where the entity is in
 * the client action registry (src/components/actions/registry.ts) the id is
 * one of its actions; budget, import and setup actions are listed in
 * catalog.ts until the registry gains those entities.
 */
export interface NeedsYouAction {
	readonly entity: string;
	readonly id: string;
}

export interface NeedsYouItem {
	/** Stable across reads: `<type>:<entity id>`, or the type alone for one-per-type items. */
	readonly id: string;
	readonly type: NeedsYouType;
	readonly group: NeedsYouGroup;
	/** The one thing the primary action acts on; null for setup prompts. */
	readonly entity: {
		readonly kind: NeedsYouEntityKind;
		readonly id: string;
	} | null;
	/** Every entity an aggregated item covers (SPEC §5.14: one item per budget type). */
	readonly entityIds: readonly string[];
	/** Faces to show, in order; identities are in the list's `people`. */
	readonly people: readonly PersonKey[];
	/** Server computed, never netted across currencies; null when the type has none. */
	readonly amount: Money | null;
	/** How many rows an aggregated item stands for (rows to review, envelopes over). */
	readonly count: number | null;
	/** The day it is about: due, paid on, the expense date. */
	readonly date: IsoDate | null;
	/** A title the user typed (expense, recurring item, envelope); never UI copy. */
	readonly title: string | null;
	/** Needs attention now (overdue, over): the client shows a word plus the attention color. */
	readonly attention: boolean;
	/** The primary action first. */
	readonly actions: readonly NeedsYouAction[];
	/** Recurring items: which way the money goes and whether the amount is asked. */
	readonly direction: "in" | "out" | null;
	readonly askAmount: boolean;
	/** budget.missingRate: the currencies without a rate, named (R14). */
	readonly currencies: readonly string[];
	/** budget.giveJob: the money that arrived and has no job yet, newest first (RC-2). */
	readonly sources: readonly NeedsYouSource[];
}

/** One money-in row behind Give it a job: its own title and day, its value in the book. */
export interface NeedsYouSource {
	readonly entryId: string;
	readonly kind: "INCOME" | "STARTING_BALANCE";
	readonly title: string;
	readonly date: IsoDate;
	/** The row's value in the book currency. */
	readonly amount: Money;
	/** How much of it is still without a job (the oldest source covers the rest). */
	readonly part: Money;
}

export interface NeedsYouFace {
	readonly key: PersonKey;
	readonly name: string;
	readonly imageUrl: string | null;
	readonly onRetrospend: boolean;
}

export interface NeedsYouList {
	readonly today: IsoDate;
	readonly items: readonly NeedsYouItem[];
	/** Items per group plus the total: the nav badges and the section count. */
	readonly counts: Readonly<Record<NeedsYouGroup | "total", number>>;
	readonly people: Readonly<Record<PersonKey, NeedsYouFace>>;
}
