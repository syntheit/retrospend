import type { Money } from "@retrospend/api-contract";
import { toMinor } from "@retrospend/domain/envelope/units";
import type { db as globalDb } from "~/server/db";
import type { Principal } from "./principal.service";

/** What a v1 adapter needs from the request: the caller and their RLS client. */
export type Caller = { db: typeof globalDb; principal: Principal };

/**
 * A stored decimal amount (a Prisma Decimal or its text) as the wire
 * Money, rounded half-even to the currency's minor unit.
 */
export function moneyOf(
	amount: { toString(): string },
	currency: string,
): Money {
	return { minor: toMinor(amount.toString(), currency), currency };
}

/** A calendar day as YYYY-MM-DD (stored dates are UTC midnights). */
export function isoDay(date: Date): string {
	return date.toISOString().slice(0, 10);
}
