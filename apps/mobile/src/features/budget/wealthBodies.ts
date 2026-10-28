import type { RetrospendClient } from "@retrospend/api-client";
import { wireAmount } from "./amount";

// Moving money between an envelope and Wealth: the transfer's own write with
// the envelope named. Leaving the budget names the envelope it comes from;
// entering names the one it goes into. null is Not planned yet (To assign).

export type TransferInput = Parameters<
	RetrospendClient["transfers"]["create"]
>[0];
export type Place = { id: string; currency: string };

export type WealthDirection = "to" | "from";

/**
 * One move. `fromPlace` and `intoPlace` are accounts (null: Not tracked, in
 * the book currency). The other currency, when the two differ, is the
 * server's reference rate: the phone never converts.
 */
export function wealthMoveBody(input: {
	id: string;
	direction: WealthDirection;
	fromPlace: Place | null;
	intoPlace: Place | null;
	envelopeId: string | null;
	minor: number | null;
	bookCurrency: string;
}): TransferInput | null {
	if (input.minor === null || input.minor <= 0) return null;
	const fromCurrency = input.fromPlace?.currency ?? input.bookCurrency;
	const toCurrency = input.intoPlace?.currency ?? input.bookCurrency;
	// A move to or from Wealth needs the account that is Wealth.
	const wealth = input.direction === "to" ? input.intoPlace : input.fromPlace;
	if (!wealth) return null;
	return {
		id: input.id,
		fromAccountId: input.fromPlace?.id ?? null,
		toAccountId: input.intoPlace?.id ?? null,
		fromCurrency,
		toCurrency,
		fromAmount: wireAmount(input.minor, fromCurrency),
		...(input.direction === "to"
			? { envelopeId: input.envelopeId }
			: { putIn: input.envelopeId }),
	};
}

type MoveInInput = Parameters<RetrospendClient["income"]["moveIn"]>[0];
/** Counting units of an account (the other branch of the write counts a kept income). */
export type CountInput = Extract<MoveInInput, { accountId: string }>;

/** Count that much of a Wealth account in the budget without moving it; the account keeps its money. */
export function countBody(input: {
	id: string;
	account: Place | null;
	envelopeId: string | null;
	minor: number | null;
}): CountInput | null {
	if (!input.account || input.minor === null || input.minor <= 0) return null;
	return {
		id: input.id,
		accountId: input.account.id,
		units: wireAmount(input.minor, input.account.currency),
		putIn: input.envelopeId,
	};
}
