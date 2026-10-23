import "server-only";

import {
	addMoney,
	type Money,
	money,
	toMinor,
} from "@retrospend/domain/money-minor";

/**
 * The seam between today's wealth procedures, which return float major
 * units, and the Money DTO the page renders ({ minor, currency }, §2.2).
 * The conversion runs once, here on the server, through the domain's
 * toMinor (float noise trimmed, half to even), never in the browser (R9).
 *
 * Temporary: track 2D deletes this file when its netWorth and account read
 * models return Money themselves.
 */
export function moneyFromMajor(amount: number, currency: string): Money {
	return money(toMinor(amount, currency), currency);
}

/** Integer minor-unit sum; an empty list is zero. */
export function sumMoney(list: readonly Money[], currency: string): Money {
	return list.reduce(addMoney, money(0, currency));
}

/** The negative of an amount's size: how a liability reads (stored either sign). */
export function owing(value: Money): Money {
	return money(-Math.abs(value.minor), value.currency);
}

/**
 * A part's share of a whole in hundredths of a percent, rounded half up,
 * in BigInt so large ARS totals stay exact. Zero when the whole is not
 * positive.
 */
export function shareOf(part: Money, whole: Money): number {
	if (whole.minor <= 0) return 0;
	const twice = (BigInt(part.minor) * 20000n) / BigInt(whole.minor);
	return Number((twice + 1n) / 2n);
}
