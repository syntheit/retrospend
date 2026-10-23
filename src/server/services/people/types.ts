/**
 * What the redesigned People, Person and Settle up screens read (R9: the
 * server computes, the client formats). Every amount is a Money DTO in
 * minor units; a missing rate is null, never 1. Balances are from the
 * viewer's side: positive = they owe you.
 */
import type { Money } from "~/server/figures/registry";

/** "type:id", the figures' personId narrowing (payments/view.ts personKey). */
export type PersonKey = string;

export type ParticipantKind = "user" | "guest" | "shadow";

export interface PersonIdentityDTO {
	readonly key: PersonKey;
	readonly type: ParticipantKind;
	readonly id: string;
	readonly name: string;
	readonly username: string | null;
	readonly imageUrl: string | null;
	/** A Retrospend account (not a person someone added by name). */
	readonly onRetrospend: boolean;
}

/** Where a person sits on the People page. */
export type PeopleGroup = "owed" | "owe" | "pending" | "settled";

/** A rate as the screens show it: 1 unit of a currency in the home currency, of a type. */
export interface RateDTO {
	readonly type: string;
	readonly unit: Money;
	readonly value: Money;
}

/** One currency of a balance, with its home value when it converts. */
export interface BalancePart {
	readonly amount: Money;
	/** Null when there is no rate (it is left out of the net). Same as amount at home. */
	readonly home: Money | null;
	readonly rate: RateDTO | null;
}

export interface PendingPaymentDTO {
	/** "in": they paid you (waits for you). "out": you paid them (waits for them). */
	readonly direction: "in" | "out";
	readonly amount: Money;
}

export interface PersonSummary {
	readonly person: PersonIdentityDTO;
	readonly group: PeopleGroup;
	/** Net in the home currency at the reference rates; null when a currency has no rate. */
	readonly net: Money | null;
	readonly parts: readonly BalancePart[];
	/** The newest payment still waiting for one side. */
	readonly pending: PendingPaymentDTO | null;
	/** Splits and payments from this person waiting for you. */
	readonly needsYou: number;
	readonly unseen: number;
	readonly lastShared: {
		readonly title: string;
		readonly date: string;
		readonly project: string | null;
	} | null;
}

/** One segment of the People balance bar, sized by the server (hundredths of a percent). */
export interface BarSegment {
	readonly key: PersonKey;
	readonly direction: "owed" | "owe";
	readonly share: number;
	readonly amount: Money;
}

export type NeedsItemDTO =
	| {
			readonly kind: "confirmPayment";
			/** The payment id. */
			readonly id: string;
			readonly person: PersonIdentityDTO;
			readonly amount: Money;
			readonly paidOn: string;
	  }
	| {
			readonly kind: "verify";
			/** The shared transaction id. */
			readonly id: string;
			readonly person: PersonIdentityDTO;
			readonly title: string;
			/** Your share. */
			readonly amount: Money;
			readonly date: string;
	  };

export interface PeopleOverview {
	readonly home: string;
	/** owed.owedToYou and owed.youOwe from the figures registry; null when a rate is missing. */
	readonly owedToYou: Money | null;
	readonly youOwe: Money | null;
	/** Currencies someone owes in that have no rate: not in any total. */
	readonly unpriced: readonly string[];
	readonly people: readonly PersonSummary[];
	readonly segments: readonly BarSegment[];
	readonly needs: readonly NeedsItemDTO[];
}

export interface ScopeDTO {
	readonly project: { readonly id: string; readonly name: string } | null;
	/** Open balance per currency in this scope; empty when settled. */
	readonly lines: readonly Money[];
	readonly settledSince: string | null;
}

export interface PaymentDTO {
	readonly id: string;
	/** "in": they paid you. "out": you paid them. */
	readonly direction: "in" | "out";
	readonly amount: Money;
	readonly paidOn: string;
	readonly method: string | null;
	readonly status: "pending" | "final";
	readonly recordedByMe: boolean;
	/** What it paid per scope; offsets cancel debts and move no cash. */
	readonly parts: readonly {
		readonly project: { readonly id: string; readonly name: string } | null;
		readonly amount: Money;
		readonly offset: boolean;
	}[];
}

export interface CategoryDTO {
	readonly name: string;
	readonly icon: string | null;
	readonly tone: number;
}

export interface FaceDTO {
	readonly id: string;
	readonly name: string;
	readonly imageUrl: string | null;
}

export interface LedgerRowDTO {
	readonly id: string;
	readonly title: string;
	readonly date: string;
	readonly amount: Money;
	readonly category: CategoryDTO | null;
	readonly project: { readonly id: string; readonly name: string } | null;
	readonly paidBy: "me" | "them" | "other";
	readonly payerName: string;
	/** Everyone in the split, with the payer's face id in payerId. */
	readonly people: readonly FaceDTO[];
	readonly payerId: string;
	/** What it does between you (positive: they owe you); null when neither of you paid. */
	readonly effect: Money | null;
	/** review: waits for your answer; rejected: you rejected it; settled: locked by a payment. */
	readonly state: "ok" | "review" | "rejected" | "settled";
	readonly canEdit: boolean;
}

export interface PersonPage {
	readonly home: string;
	readonly person: PersonIdentityDTO;
	readonly net: Money | null;
	readonly parts: readonly BalancePart[];
	readonly settled: {
		readonly since: string | null;
		readonly pending: boolean;
		readonly nothingShared: boolean;
	};
	readonly scopes: readonly ScopeDTO[];
	readonly payments: readonly PaymentDTO[];
	readonly rows: readonly LedgerRowDTO[];
	/** All shared expenses, when rows holds only the newest. */
	readonly rowCount: number;
	readonly stats: {
		readonly since: string | null;
		readonly expenses: number;
		readonly projects: number;
	};
	readonly needs: readonly NeedsItemDTO[];
}
