/**
 * Reads shared by every device figure in one read pass: each table listed once,
 * settings, owed, rate groups and not-tracked units, bound to the reader the pass
 * started with. Without a pass every call is a plain read.
 */
import {
	notTrackedUnitsOf,
	type OwedReading,
} from "@retrospend/domain/accounts/account-figures";
import type { FigurePass } from "@retrospend/domain/figures/registry";
import {
	type RateRow,
	rateLookup,
	rateRowsByCurrency,
	type StoredRateRow,
} from "@retrospend/domain/money";
import { NotFoundError } from "./errors";
import {
	OWED_ID,
	type Reader,
	type SettingsRow,
	type TableName,
	type TableRows,
} from "./port";
import { settingsReads } from "./reference";

/**
 * What one read pass has loaded from its reader, so a pass over many figures
 * lists each table once instead of once per figure. A pass is one reader's
 * reads with no write between (the FigurePass contract), so what it loaded
 * cannot go stale; a pass handed to a different reader gets no memo.
 */
export interface PassReads {
	readonly db: Reader;
	readonly tables: Map<TableName, readonly unknown[]>;
	settings?: SettingsRow;
	/** The rate rows of every currency, grouped once. */
	rateRows?: Record<string, RateRow[]>;
	notTracked?: ReturnType<typeof notTrackedUnitsOf>;
}

const passReads = new WeakMap<FigurePass, PassReads>();

export function readsOf(db: Reader, pass?: FigurePass): PassReads | undefined {
	if (!pass) return undefined;
	let reads = passReads.get(pass);
	if (!reads) {
		reads = { db, tables: new Map() };
		passReads.set(pass, reads);
	}
	return reads.db === db ? reads : undefined;
}

/** The rows of `table`, listed once per pass; a plain list when there is no pass. */
export function rowsIn<T extends TableName>(
	db: Reader,
	pass: FigurePass | undefined,
	table: T,
): readonly TableRows[T][] {
	const reads = readsOf(db, pass);
	if (!reads) return db.list(table);
	let rows = reads.tables.get(table);
	if (rows === undefined) {
		rows = db.list(table);
		reads.tables.set(table, rows);
	}
	return rows as readonly TableRows[T][];
}

/** The settings row; a store without one throws (NotFoundError), never a USD fallback. */
export function settingsOf(db: Reader, pass?: FigurePass): SettingsRow {
	const reads = readsOf(db, pass);
	if (reads?.settings) return reads.settings;
	const row = settingsReads(db).require();
	if (reads) reads.settings = row;
	return row;
}

/** The not-tracked units of the pass's legs, summed once. */
export function notTrackedIn(db: Reader, pass?: FigurePass) {
	const reads = readsOf(db, pass);
	if (reads?.notTracked) return reads.notTracked;
	const units = notTrackedUnitsOf(rowsIn(db, pass, "legs"));
	if (reads) reads.notTracked = units;
	return units;
}

/**
 * Owed to you and You owe from the `owed` row a shares sync wrote. Shared
 * money stays server-computed (the spike, 43-45), so the device reads the
 * server's totals from its store: constant within a pass, never changed by a
 * device write. No row (shares never pulled), or totals in another currency
 * than the home currency (settings changed since the pull), throws instead of
 * guessing: a missing total is never 0, and a stale one would be wrong.
 */
export function owedOf(db: Reader, home: string): OwedReading {
	const row = db.get("owed", OWED_ID);
	if (!row) throw new NotFoundError("owed does not exist");
	if ("missingRates" in row) return { missingRates: row.missingRates };
	if (row.currency !== home)
		throw new NotFoundError(
			`owed is in ${row.currency}, not the home currency ${home}`,
		);
	return { owedToYou: row.owedToYou, youOwe: row.youOwe };
}

/**
 * The rate rows of `currencies` (USD has none), as rateRowsByCurrency gives
 * them. With a pass the rows are grouped once for every currency and each call
 * takes its currencies from that, so a currency not asked for is still absent.
 */
export function ratesOf(
	db: Reader,
	pass: FigurePass | undefined,
	currencies: Iterable<string>,
): Record<string, RateRow[]> {
	const rates: readonly StoredRateRow[] = rowsIn(db, pass, "rates");
	const reads = readsOf(db, pass);
	if (!reads) return rateRowsByCurrency(rates, currencies);
	reads.rateRows ??= rateRowsByCurrency(
		rates,
		rates.map((r) => r.currency),
	);
	const picked: Record<string, RateRow[]> = {};
	for (const currency of currencies) {
		const rows = reads.rateRows[currency];
		if (rows) picked[currency] = rows;
	}
	return picked;
}

/** Rate lookups over the rows of `currencies`, picked in memory as the server's batch lookup does. */
export function lookupFor(
	db: Reader,
	pass: FigurePass | undefined,
	currencies: Iterable<string>,
) {
	return rateLookup(ratesOf(db, pass, currencies));
}

/** The instant one pass reads at: the same for every figure of the pass. */
export function readNow(clock: () => Date, pass?: FigurePass): Promise<Date> {
	const read = async () => new Date(clock().getTime());
	return pass ? pass.once("device:now", read) : read();
}

/** A once-per-pass load, or a plain one when there is no pass. */
export function once<T>(
	pass: FigurePass | undefined,
	key: string,
	load: () => Promise<T>,
): Promise<T> {
	return pass ? pass.once(key, load) : load();
}
