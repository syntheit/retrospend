/**
 * Rates on the device (E2EE lane P, P15).
 *
 * The daily table (GET /rates/daily) is the server's whole exchange_rate
 * table. `applyDailyTable` puts it in the `rates` table, the one every figure
 * and every price reads, replacing what was there. The rate history
 * (GET /rates/history) is for charts only and lives in `RateHistoryStore`,
 * which is not a store table: history rows in `rates` would give the device a
 * different pick than the server, whose prices never read them.
 *
 * A rate is never defaulted: a row whose rate is not a positive decimal
 * refuses the whole table, and a currency with no row stays absent, so a price
 * for it throws MissingRateError (the finder returns null).
 */
import { dec } from "@retrospend/domain/precise-decimal";
import {
	InvalidInputError,
	RATE_SYNC_ID,
	type Reader,
	type TableRows,
	type Writer,
} from "./port";

/** A row of the daily table as the server sends it (the wire DailyRate). */
export interface DailyRateRow {
	readonly id: string;
	readonly currency: string;
	readonly type: string;
	/** The stored instant, ISO 8601. */
	readonly date: string;
	/** Units of currency per USD, as plain decimal text. */
	readonly unitsPerUsd: string;
}

/** The body of GET /rates/daily. */
export interface DailyTable {
	readonly asOf: string | null;
	readonly rates: readonly DailyRateRow[];
}

const PLAIN_DECIMAL = /^\d+(\.\d+)?$/;

function assertRate(unitsPerUsd: string, what: string): void {
	if (!PLAIN_DECIMAL.test(unitsPerUsd) || !dec(unitsPerUsd).gt(0))
		throw new InvalidInputError(`${what} has no valid rate`);
}

function rateRowOf(r: DailyRateRow): TableRows["rates"] {
	assertRate(r.unitsPerUsd, `Rate ${r.id}`);
	const date = new Date(r.date);
	if (Number.isNaN(date.getTime()))
		throw new InvalidInputError(`Rate ${r.id} has no valid date`);
	return {
		id: r.id,
		currency: r.currency,
		type: r.type,
		rate: r.unitsPerUsd,
		date,
	};
}

/**
 * Replaces the whole `rates` table with the daily table and records its
 * `asOf`, all in `tx`, so the caller's commit applies both or neither. Every
 * row is checked before the first write, so a bad table leaves `tx` as it was.
 * A currency the table lacks loses its rows; nothing is kept from the old table.
 */
export function applyDailyTable(tx: Writer, table: DailyTable): void {
	const rows = table.rates.map(rateRowOf);
	if (new Set(rows.map((r) => r.id)).size !== rows.length)
		throw new InvalidInputError("The rate table repeats an id");
	for (const old of tx.list("rates")) tx.delete("rates", old.id);
	for (const row of rows) tx.put("rates", row);
	tx.put("rateSync", { id: RATE_SYNC_ID, asOf: table.asOf });
}

/** The `asOf` the last sync stored; null before the first one, or after an empty table. */
export const ratesAsOf = (r: Reader): string | null =>
	r.get("rateSync", RATE_SYNC_ID)?.asOf ?? null;

/** A row of GET /rates/history (the wire HistoryRate). */
export interface HistoryRateRow {
	/** The day, YYYY-MM-DD. */
	readonly date: string;
	readonly currency: string;
	readonly type: string;
	readonly unitsPerUsd: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const keyOf = (r: HistoryRateRow) => `${r.date}|${r.currency}|${r.type}`;
const order = (a: HistoryRateRow, b: HistoryRateRow) =>
	keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0;

/**
 * Stored rate days for charts. Outside the engine store on purpose, so no
 * figure loader can read it: only a chart does, through `list`. Pages merge in
 * by (date, currency, type), a later page replacing an earlier row.
 */
export class RateHistoryStore {
	private readonly rows = new Map<string, HistoryRateRow>();

	/** Adds a page of rows; a bad row refuses the page and changes nothing. */
	merge(page: readonly HistoryRateRow[]): void {
		for (const r of page) {
			if (!DAY.test(r.date))
				throw new InvalidInputError(`Rate day ${r.date} is not a date`);
			assertRate(r.unitsPerUsd, `Rate day ${keyOf(r)}`);
		}
		for (const r of page) this.rows.set(keyOf(r), { ...r });
	}

	/** Rows by (date, currency, type), oldest first; `from` and `to` are inclusive days. */
	list(
		filter: {
			currency?: string;
			type?: string;
			from?: string;
			to?: string;
		} = {},
	): HistoryRateRow[] {
		return [...this.rows.values()]
			.filter(
				(r) =>
					(filter.currency === undefined || r.currency === filter.currency) &&
					(filter.type === undefined || r.type === filter.type) &&
					(filter.from === undefined || r.date >= filter.from) &&
					(filter.to === undefined || r.date <= filter.to),
			)
			.sort(order)
			.map((r) => ({ ...r }));
	}

	clear(): void {
		this.rows.clear();
	}
}
