/**
 * View models of the entity rows. The server computes every number (R9):
 * amounts arrive as Money in minor units, shares and progress as hundredths
 * of a percent, dates as ISO date-only strings. Rows format, never compute.
 */
import type { ReactNode } from "react";
import type { MoneyValue } from "~/components/money/format";
import type { FacePerson } from "~/components/ui/avatar-face";

/** A category's identity: its name, its icon key and its color slot (1 to 21). */
export type CategoryRef = {
	name: string;
	/** Icon key from the category icon registry; null picks one from the name. */
	icon?: string | null;
	/** The category color token, category-1 to category-21. */
	tone: number;
};

/** Hundredths of a percent, as the server sends shares and progress (2500 = 25%). */
export type Basis = number;

export type TransactionKind =
	| "expense"
	| "income"
	| "refund"
	| "reimbursement"
	| "payment"
	| "transfer"
	| "exchange"
	| "balance";

export type TransactionVM = {
	id: string;
	title: string;
	kind: TransactionKind;
	/** Null for money moves (payment, transfer, exchange, balance update). */
	category: CategoryRef | null;
	/** The amount as entered, in its own currency. */
	amount: MoneyValue;
	/** The home amount when the currency is foreign; null means no rate yet. */
	home?: MoneyValue | null;
	/** Your share of a split, as the server sends it (Activity: home; a project: its currency). */
	share?: MoneyValue;
	/**
	 * In a ledger with one person (person.html): what this row does to your
	 * balance with them (positive: they owe you), or why it does nothing.
	 * A payment says who paid whom instead.
	 */
	between?: {
		amount: MoneyValue | null;
		state: "ok" | "review" | "rejected" | "settled";
		/** A payment: "in" they paid you, "out" you paid them. */
		paid?: "in" | "out";
		figure?: string;
	};
	/** The other side of an exchange. */
	counter?: MoneyValue;
	/** The rate behind a foreign amount, as the server words it. */
	rateTip?: string;
	/**
	 * The server's sort key for the amount column: this row's value in home
	 * minor units. Null when there is no rate yet; such rows sort last. A
	 * table never sorts native minor units across currencies.
	 */
	sortKey?: number | null;
	/** Figures registry keys of the amount and of your share, for the audit. */
	figure?: string;
	shareFigure?: string;
	reviewed: boolean;
	/** A shared expense waiting on you, or one you rejected. */
	waiting?: "review" | "rejected";
	/** A payment that the other side has not confirmed yet. */
	pending?: boolean;
	/** The project, with its cover (photo or illustrated scene) when it has one. */
	project?: { id: string; name: string; cover?: ReactNode } | null;
	/** Everyone in the split, you included. */
	people?: FacePerson[];
	payerId?: string;
	/** Set when someone other than you paid. */
	payerName?: string;
	/** ISO date (YYYY-MM-DD). */
	date: string;
};

export type PersonVM = {
	id: string;
	name: string;
	imageUrl?: string | null;
	onRetrospend: boolean;
	/** What you last shared, as the server words it. It gives way when narrow. */
	lastShared: string;
	/** When that was ("3 days ago"); kept whole after it. */
	when?: string;
	/** Positive: they owe you. Negative: you owe them. Zero: settled. */
	balance: MoneyValue;
	/** The balance is a net converted across currencies: it reads "≈". */
	approx?: boolean;
	/**
	 * The balance in each currency as it is held (signed like the balance),
	 * shown under the net when it is not one amount in the home currency.
	 */
	parts?: MoneyValue[];
	/** A payment waiting for one side; it takes the balance's place. */
	pending?: { direction: "in" | "out"; amount: MoneyValue } | null;
	/** Changes since you last looked: the attention dot on the face. */
	unseen?: number;
	/** Splits and payments from them that wait for you. */
	needsYou?: number;
	/** Figures registry key of the balance. */
	figure?: string;
	href: string;
};

export type ProjectVM = {
	id: string;
	name: string;
	href: string;
	/** The cover (user photo or illustrated scene); a flat tile when absent. */
	cover?: ReactNode;
	solo: boolean;
	/** The other people in the project, for the faces. */
	people: FacePerson[];
	/** Everyone, you included. */
	peopleCount: number;
	/** ISO dates; no start means open-ended. */
	start?: string | null;
	end?: string | null;
	/** Your balance in a shared project. */
	balance?: MoneyValue | null;
	/** Total spent in a solo project (or a shared one with no balance). */
	spent?: MoneyValue;
	/** Figures registry key of the balance or the spent amount. */
	figure?: string;
	/** How much of the budget is used, when there is one. */
	budgetUsed?: { basis: Basis; over: boolean } | null;
};

export type AccountKind =
	| "bank"
	| "cash"
	| "invest"
	| "crypto"
	| "property"
	| "liability";

export type AccountVM = {
	id: string;
	name: string;
	kind: AccountKind;
	/** Native amount; liabilities are negative. */
	amount: MoneyValue;
	/** Home value when the currency differs; null means no rate yet. */
	home?: MoneyValue | null;
	/** ISO date of the last update. */
	updated: string;
	/** Signed change this month, in hundredths of a percent. */
	change?: Basis | null;
	/** Figures registry keys of the native and home amounts. */
	figure?: string;
	homeFigure?: string;
};

export type EnvelopeVM = {
	id: string;
	name: string;
	category: CategoryRef;
	available: MoneyValue;
	status: "funded" | "underfunded" | "overspent";
	/** Spent against assigned, capped at 10000. */
	spent: Basis;
	/** Figures registry key of the available amount. */
	figure?: string;
};

export type RecurringFrequency =
	| "weekly"
	| "biweekly"
	| "monthly"
	| "quarterly"
	| "yearly";

export type RecurringVM = {
	id: string;
	title: string;
	category: CategoryRef;
	frequency: RecurringFrequency;
	/** ISO date of the next occurrence. */
	next: string;
	state: "upcoming" | "due" | "overdue";
	direction: "out" | "in";
	amount: MoneyValue;
	/** Home value when foreign; null means no rate yet. */
	home?: MoneyValue | null;
	/** Figures registry key of the amount. */
	figure?: string;
	/** Whether auto-pay books it on the day; set it to show the auto-pay line. */
	autoPay?: boolean;
	/** A paused template: muted, "Paused" instead of the next date. */
	paused?: boolean;
};
