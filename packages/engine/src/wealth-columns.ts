/**
 * The columns the device and the server must hold equal for the rows of an
 * account or transfer write, one comparison per column. The one owner: the
 * conformance suites (device against server, row by row) and the write
 * compare (a booked entry against the row a pull brought) both read it.
 */
import { dec } from "@retrospend/domain/precise-decimal";
import type {
	AccountRow,
	LegRow,
	RateSwitchRow,
	SnapshotRow,
} from "./accounts";
import type { TableRows } from "./port";
import type { WealthTable } from "./wealth-rows";

/** Decimals equal by value, null only to null. */
export const sameDecimal = (a: string | null, b: string | null) =>
	a === null || b === null ? a === b : dec(a).eq(dec(b));

/** One comparison per column of a port row: a column added to the row type fails to compile until it is named here. */
export type Columns<R> = {
	readonly [K in keyof R]-?: (a: R[K], b: R[K]) => boolean;
};

export const exact = <T>(a: T, b: T) => (a ?? null) === (b ?? null);
export const instant = (a: Date | null, b: Date | null) =>
	(a?.getTime() ?? null) === (b?.getTime() ?? null);
export const decimal = (
	a: string | null | undefined,
	b: string | null | undefined,
) => sameDecimal(a ?? null, b ?? null);
/** Compared elsewhere: rows are matched by id (a snapshot by account and day), so the id is the key. */
export const byKey = () => true;

export const ACCOUNT_COLUMNS: Columns<AccountRow> = {
	id: byKey,
	type: exact,
	currency: exact,
	name: exact,
	balance: decimal,
	exchangeRate: decimal,
	exchangeRateType: exact,
	closedAt: instant,
	inBudget: exact,
	countedUnits: decimal,
	isLiquid: exact,
	interestRate: decimal,
	minimumPayment: decimal,
	dueDate: exact,
	iconKind: exact,
	version: exact,
	// The database stamps it; the device writes the instant it booked.
	createdAt: () => true,
};

export const LEG_COLUMNS: Columns<LegRow> = {
	id: byKey,
	accountId: exact,
	currency: exact,
	date: instant,
	createdAt: instant,
	amount: decimal,
	source: exact,
	homeAmount: decimal,
	homeCurrency: exact,
	countedUnits: decimal,
	transferId: exact,
	expenseId: exact,
};

export const SNAPSHOT_COLUMNS: Columns<SnapshotRow> = {
	id: byKey,
	accountId: byKey,
	date: byKey,
	recordedAt: instant,
	balance: decimal,
	currency: exact,
	exchangeRateType: exact,
};

export const SWITCH_COLUMNS: Columns<RateSwitchRow> = {
	id: byKey,
	accountId: exact,
	from: instant,
	type: exact,
	previousType: exact,
	createdAt: instant,
};

/** The names of the columns that differ. */
export function differing<R extends object>(
	columns: Columns<R>,
	device: R,
	server: R,
): string[] {
	return (Object.keys(columns) as (keyof R & string)[]).filter(
		(k) =>
			!(columns[k] as (a: unknown, b: unknown) => boolean)(
				device[k],
				server[k],
			),
	);
}

export const TRANSFER_COLUMNS: Columns<TableRows["transfers"]> = {
	id: byKey,
	kind: exact,
	date: instant,
	fromAccountId: exact,
	fromAmount: decimal,
	toAccountId: exact,
	toAmount: decimal,
	toCurrency: exact,
	feeExpenseId: exact,
	countedFromUnits: decimal,
	countedToUnits: decimal,
	note: exact,
};

type Same = (a: unknown, b: unknown) => boolean;

const WEALTH_COLUMNS: Record<WealthTable, Readonly<Record<string, Same>>> = {
	accounts: ACCOUNT_COLUMNS as unknown as Readonly<Record<string, Same>>,
	legs: LEG_COLUMNS as unknown as Readonly<Record<string, Same>>,
	snapshots: SNAPSHOT_COLUMNS as unknown as Readonly<Record<string, Same>>,
	rateSwitches: SWITCH_COLUMNS as unknown as Readonly<Record<string, Same>>,
	transfers: TRANSFER_COLUMNS as unknown as Readonly<Record<string, Same>>,
};

/**
 * The names of the columns of a `table` row that differ between two rows, by
 * the table's comparisons (decimals by value, instants by time), leaving out
 * `skip`. A row with a column missing is read as null there.
 */
export function differingColumns(
	table: WealthTable,
	a: object,
	b: object,
	skip: readonly string[] = [],
): string[] {
	const columns = WEALTH_COLUMNS[table];
	const row = (r: object) => r as Record<string, unknown>;
	return Object.keys(columns).filter(
		(k) =>
			!skip.includes(k) &&
			!(columns[k] as Same)(row(a)[k] ?? null, row(b)[k] ?? null),
	);
}
