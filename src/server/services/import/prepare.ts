/**
 * The one reading of a job's rows that the review shows and the commit
 * writes: dates in the user's zone and the currency override ("Currency"
 * chip). Which rows are already in Activity is match.ts. Both call these, so the review
 * cannot promise a count the commit does not keep.
 */
import {
	SealedTextError,
	stripUserTextControls,
} from "@retrospend/api-contract/common";
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
	/**
	 * Rows whose title, location or description starts with U+0001, the marker
	 * of an encrypted value. Never imported: cleaning it would store the
	 * ciphertext as text.
	 */
	readonly badText: number;
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
	let badText = 0;
	stored.forEach((row, index) => {
		let date: Date;
		try {
			date = parseDateOnlyIn(row.date, options.timeZone);
		} catch {
			badDates++;
			return;
		}
		let title: string;
		try {
			title = stripUserTextControls(row.title).trim();
			for (const text of [row.location, row.description])
				if (text) stripUserTextControls(text);
		} catch (error) {
			if (!(error instanceof SealedTextError)) throw error;
			badText++;
			return;
		}
		const override = options.currency?.toUpperCase();
		const currency = override ?? row.currency.toUpperCase();
		rows.push({
			index,
			stored: row,
			title,
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
	return { rows, badDates, badText };
}
