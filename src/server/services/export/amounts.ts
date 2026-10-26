/**
 * Money text in the export documents. Every amount is read exactly (a
 * Decimal's text, never a float) and summed as integer minor units; rounding
 * happens once, half to even, when a stored amount is shown at its
 * currency's own precision. Display strings use the shared domain
 * formatter's plain form (fromMinor): no grouping, no symbol, so a column of
 * them lines up and a spreadsheet can read them back.
 */
import { isCrypto } from "@retrospend/domain/currency-format";
import { fromMinor } from "@retrospend/domain/money-minor";
import { CsvNumber } from "~/lib/csv";
import type { DecimalLike } from "~/server/services/envelope/types";
import { toMinor } from "~/server/services/envelope/units";

/** A stored amount in integer minor units, rounded half to even once. */
export function minorOf(amount: DecimalLike, currency: string): number {
	return toMinor(amount, currency);
}

const trimZeros = (text: string) =>
	text.includes(".") ? text.replace(/\.?0+$/, "") : text;

/** "-1234.50" (fiat keeps its own digits); crypto drops trailing zeros: "0.004". */
export function minorText(minor: number, currency: string): string {
	const text = fromMinor({ minor, currency });
	return isCrypto(currency) ? trimZeros(text) : text;
}

/** A stored amount as a display string: "30.00", "0.004" (ETH). */
export function amountText(amount: DecimalLike, currency: string): string {
	return minorText(minorOf(amount, currency), currency);
}

/**
 * A stored amount as a spreadsheet number, exactly as stored and without
 * trailing zeros ("12.5", "0.004", "-5"). Not rounded: a CSV is a record,
 * and the number guard must not turn "-5" into text.
 */
export function exactCell(amount: DecimalLike): CsvNumber {
	return new CsvNumber(typeof amount === "string" ? amount : amount.toFixed());
}

/** A summed amount (minor units) as a spreadsheet number: "46.01", "20", "0.002". */
export function minorCell(minor: number, currency: string): CsvNumber {
	return new CsvNumber(trimZeros(fromMinor({ minor, currency })));
}

const byCode = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Totals per currency, sorted by code: ["1234.50 ARS", "50.00 USD"]. A
 * document with no amounts shows zero in `fallbackCurrency`. Currencies are
 * never added together.
 */
export function totalsText(
	rows: ReadonlyArray<{ amount: DecimalLike; currency: string }>,
	fallbackCurrency: string,
): string[] {
	const totals = new Map<string, number>();
	for (const row of rows) {
		totals.set(
			row.currency,
			(totals.get(row.currency) ?? 0) + minorOf(row.amount, row.currency),
		);
	}
	if (totals.size === 0) totals.set(fallbackCurrency, 0);
	return [...totals]
		.sort(([a], [b]) => byCode(a, b))
		.map(([currency, minor]) => `${minorText(minor, currency)} ${currency}`);
}
