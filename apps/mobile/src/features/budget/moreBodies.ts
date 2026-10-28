import type { RetrospendClient } from "@retrospend/api-client";
import { wireAmount } from "./amount";
import { isIsoDay } from "./DayField";

// The request bodies of the budget sheets beyond the first six: new envelope,
// rename or move, combine, target, style and the afford question. Each
// preview twin takes the same body as its write, so a sheet builds one body
// and sends it to both. Text is sent exactly as typed (rule 11); the sheet
// only decides whether it is empty.

type Client = RetrospendClient["budget"];
export type CreateEnvelopeInput = Parameters<Client["createEnvelope"]>[0];
export type UpdateEnvelopeInput = Parameters<Client["updateEnvelope"]>[0];
export type MergeInput = Parameters<Client["mergeEnvelopes"]>[0];
export type TargetInput = Parameters<Client["setTarget"]>[0];
export type StyleInput = Parameters<Client["setStyle"]>[0];
export type AffordInput = Parameters<Client["afford"]>[0];
export type SwitchStyle = StyleInput["style"];

/** A name is usable when it has a letter in it; the server holds the limit. */
export function nameOk(name: string): boolean {
	return name.trim().length > 0;
}

export function createEnvelopeBody(input: {
	id: string;
	name: string;
	groupId: string | null;
	/** The categories it covers; a category lives in one envelope, so each moves here. */
	categoryIds?: readonly string[];
}): CreateEnvelopeInput {
	return {
		id: input.id,
		name: input.name.trim(),
		groupId: input.groupId,
		kind: "NONE",
		categoryIds: [...(input.categoryIds ?? [])],
	};
}

/** The same set of ids, whatever the order. */
export function sameIds(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((id) => b.includes(id));
}

/** Only what changed is sent; null when nothing did. */
export function updateEnvelopeBody(input: {
	id: string;
	envelopeId: string;
	name: string;
	groupId: string | null;
	/** The full list of categories it should cover; left out, they are not touched. */
	categoryIds?: readonly string[];
	was: {
		name: string;
		groupId: string | null;
		categoryIds?: readonly string[];
	};
}): UpdateEnvelopeInput | null {
	const name = input.name.trim();
	const renamed = name !== "" && name !== input.was.name;
	const moved = input.groupId !== input.was.groupId;
	const recategorized =
		input.categoryIds !== undefined &&
		!sameIds(input.categoryIds, input.was.categoryIds ?? []);
	if (!renamed && !moved && !recategorized) return null;
	return {
		id: input.id,
		envelopeId: input.envelopeId,
		...(renamed ? { name } : {}),
		...(moved ? { groupId: input.groupId } : {}),
		...(recategorized && input.categoryIds
			? { categoryIds: [...input.categoryIds] }
			: {}),
	};
}

/** Combine: the one that stays, the ones that go into it, and optionally a new name. */
export function mergeBody(input: {
	id: string;
	intoId: string | null;
	fromIds: readonly string[];
	name: string;
	was: string | null;
}): MergeInput | null {
	const { intoId } = input;
	if (!intoId) return null;
	const fromIds = input.fromIds.filter((id) => id !== intoId);
	if (fromIds.length === 0) return null;
	const name = input.name.trim();
	return {
		id: input.id,
		intoId,
		fromIds,
		...(name !== "" && name !== input.was ? { name } : {}),
	};
}

export type TargetChoice = "NONE" | "MONTHLY" | "BILL" | "SAVINGS";
/** How often a bill comes back; ONCE is a bill that does not repeat. */
export type BillRepeat = "MONTHLY" | "QUARTERLY" | "YEARLY" | "ONCE";
export type TargetMode = "REFILL" | "SET_ASIDE";

/** The target an envelope gets: none, a monthly amount, or a savings goal. */
export function targetBody(input: {
	id: string;
	envelopeId: string;
	choice: TargetChoice;
	mode: TargetMode;
	minor: number | null;
	currency: string;
	/** A bill: the day it is due (YYYY-MM-DD) and how often. */
	dueDate?: string;
	repeat?: BillRepeat;
}): TargetInput | null {
	if (input.choice === "NONE") {
		return {
			id: input.id,
			envelopeId: input.envelopeId,
			kind: "NONE",
			target: null,
		};
	}
	if (input.minor === null) return null;
	const amount = wireAmount(input.minor, input.currency);
	if (input.choice === "BILL") {
		if (!input.dueDate || !isIsoDay(input.dueDate) || input.minor <= 0) {
			return null;
		}
		return {
			id: input.id,
			envelopeId: input.envelopeId,
			kind: "BILL",
			target: {
				kind: "BILL",
				amount,
				dueDate: input.dueDate,
				repeat: input.repeat && input.repeat !== "ONCE" ? input.repeat : null,
			},
		};
	}
	return {
		id: input.id,
		envelopeId: input.envelopeId,
		kind: input.choice,
		target:
			input.choice === "MONTHLY"
				? { kind: "MONTHLY", amount, mode: input.mode, cadence: "MONTH" }
				: { kind: "SAVINGS", amount },
	};
}

/** Switching style; leaving Limits asks how much you have right now. */
export function styleBody(input: {
	id: string;
	style: SwitchStyle;
	from: string;
	haveNowMinor: number | null;
	currency: string;
}): StyleInput | null {
	const leavingLimits = input.from === "LIMITS" && input.style !== "LIMITS";
	if (leavingLimits && input.haveNowMinor === null) return null;
	return {
		id: input.id,
		style: input.style,
		leftovers: "STYLE_DEFAULT",
		...(leavingLimits && input.haveNowMinor !== null
			? { haveNow: wireAmount(input.haveNowMinor, input.currency) }
			: {}),
	};
}

export function affordQuery(input: {
	month: number;
	minor: number;
	currency: string;
	envelopeId: string | null;
}): AffordInput {
	return {
		month: input.month,
		amount: wireAmount(input.minor, input.currency),
		...(input.envelopeId ? { envelopeId: input.envelopeId } : {}),
	};
}

export type ReconcileInput = Parameters<Client["reconcile"]>[0];

/** What the bank says now, in the currency the server holds the budget in; null until there is a figure. */
export function reconcileBody(input: {
	id: string;
	minor: number | null;
	currency: string;
}): ReconcileInput | null {
	if (input.minor === null) return null;
	return { id: input.id, bank: wireAmount(input.minor, input.currency) };
}

export type DebtPaymentInput = Parameters<Client["recordDebtPayment"]>[0];

/**
 * Pay down a debt: the part toward the balance leaves the paying envelope
 * (null: the pool) and the account it came from (null: not tracked). Interest
 * in the payment is spending (Fees), not balance, and is asked apart.
 */
export function debtPaymentBody(input: {
	id: string;
	liabilityId: string | null;
	fromAccountId: string | null;
	envelopeId: string | null;
	minor: number | null;
	/** Interest in this payment, in minor units; none when left out. */
	interestMinor?: number;
	currency: string;
}): DebtPaymentInput | null {
	if (!input.liabilityId || input.minor === null) return null;
	return {
		id: input.id,
		liabilityId: input.liabilityId,
		fromAccountId: input.fromAccountId,
		envelopeId: input.envelopeId,
		principal: wireAmount(input.minor, input.currency),
		interest: wireAmount(input.interestMinor ?? 0, input.currency),
	};
}
