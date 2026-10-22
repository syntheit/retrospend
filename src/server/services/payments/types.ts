/**
 * Shared shapes of the payments engine (MONEY-MOVES §1, IMPLEMENTATION 2C).
 * Money is integer minor units of one currency, never a float; rates are
 * Decimals. Scopes are a project id, or null for "Outside projects" (the
 * direct bucket).
 */
import type { Decimal } from "@prisma/client/runtime/index-browser";
import type { IsoDate, Minor } from "~/server/services/envelope/types";

export type { IsoDate, Minor };

export type Scope = string | null;

/**
 * One (scope, currency) balance of a pair, signed from the PAYER's side:
 * positive = the payer owes the payee there, negative = the payee owes the
 * payer. `oldest` is the date of the earliest debt in that direction not yet
 * covered (first in, first out), or null when the line is zero.
 */
export interface PairLine {
	readonly scope: Scope;
	readonly currency: string;
	readonly owed: Minor;
	readonly oldest: IsoDate | null;
}

/**
 * How a debt currency converts into the payment currency: `perUnit` units
 * of the payment currency per 1 unit of the debt currency, of `rateType`
 * (blue, official, mep, card, custom).
 */
export interface Quote {
	readonly perUnit: Decimal;
	readonly rateType: string;
}

/** Restricts an allocation to some scopes, and optionally one currency in each ("Apply to"). */
export interface ApplyTo {
	readonly scope: Scope;
	readonly currency?: string;
}
