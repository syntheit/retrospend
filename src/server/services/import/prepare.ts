/**
 * The one reading of a job's rows that the review shows and the commit
 * writes: dates in the user's zone and the currency override ("Currency"
 * chip). Which rows are already in Activity is match.ts. Both call these, so the review
 * cannot promise a count the commit does not keep.
 */
import { parseDateOnlyIn } from "@retrospend/domain/time-zone";
import type { ImportRateInput } from "./book";
import { type ImportKind, proposeKind, type StoredRow } from "./rows";

export interface PreparedRow {
	readonly index: number;
	readonly stored: StoredRow;
	readonly title: string;
	readonly date: Date;
	/** YYYY-MM-DD as the file has it. */
	readonly day: string;
	readonly rate: ImportRateInput;
	readonly proposed: ImportKind;
}

export interface Prepared {
	readonly rows: PreparedRow[];
	/** Rows whose date the file has but cannot be read; never imported. */
	readonly badDates: number;
}

/**
 * `currency` replaces every row's currency; the file's rate and USD amount
 * belonged to the old one, so the table decides the rate then.
 */
export function prepareRows(
	stored: readonly StoredRow[],
	options: { currency?: string | null; timeZone?: string },
): Prepared {
	const rows: PreparedRow[] = [];
	let badDates = 0;
	stored.forEach((row, index) => {
		let date: Date;
		try {
			date = parseDateOnlyIn(row.date, options.timeZone);
		} catch {
			badDates++;
			return;
		}
		const override = options.currency?.toUpperCase();
		const currency = override ?? row.currency.toUpperCase();
		rows.push({
			index,
			stored: row,
			title: row.title.trim(),
			date,
			day: row.date,
			rate: {
				amount: row.amount,
				currency,
				date,
				...(override
					? {}
					: {
							exchangeRate: row.exchangeRate,
							amountInUSD: row.amountInUSD,
							rateSource: row.rateSource,
						}),
			},
			proposed: proposeKind(row),
		});
	});
	return { rows, badDates };
}
