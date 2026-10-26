/**
 * Shared types for the pure envelope budget modules (budget SPEC §3 to §5,
 * build plan 02 §2 and §3). No I/O here and in the modules that import it:
 * loaders turn Prisma rows into these shapes, the modules compute.
 *
 * Money is integer minor units of one currency (`Minor`), the same
 * convention as the Money DTO `{ minor, currency }` (IMPLEMENTATION §2.2).
 * Decimal inputs (row amounts, rates, APRs) arrive as strings or Prisma
 * Decimals and are only multiplied with Decimal math, never floats.
 */
import type { Decimal } from "@prisma/client/runtime/index-browser";

export { MissingRateError } from "@retrospend/domain/money";

/** Integer minor units (cents, satoshis, fils). Always a safe integer. */
export type Minor = number;

/** Budget month key, YYYYMM (202610 = October 2026). */
export type MonthKey = number;

/** Calendar date YYYY-MM-DD. Compared as dates, never as instants (SPEC §5.1). */
export type IsoDate = string;

/** A decimal value as stored: a string or a Prisma Decimal. Never a float. */
export type DecimalLike = string | Decimal;

/** What an envelope is for (SPEC §3, §5.4). */
export type EnvelopeKind = "MONTHLY" | "BILL" | "SAVINGS" | "NONE";

/** Monthly spending target style (02 §9.1 Q2). */
export type TargetMode = "REFILL" | "SET_ASIDE";

/** Monthly spending target per month or per week (SPEC §5.4, D69). */
export type TargetCadence = "MONTH" | "WEEK";

/** Group target (SPEC §5.9). */
export type GroupTargetKind = "NONE" | "AMOUNT" | "PERCENT_OF_INCOME";

/** Payoff plan order (SPEC §5.11). */
export type PayoffStrategy = "SNOWBALL" | "AVALANCHE" | "CUSTOM";

/** A rate that a figure needed and did not have (SPEC §5.3, C18). */
export interface MissingRate {
	currency: string;
	rateType: string | null;
	date: IsoDate;
	rowId?: string;
}

/** A target whose settings do not form a valid combination (SPEC §5.4). */
export class TargetConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TargetConfigError";
	}
}
