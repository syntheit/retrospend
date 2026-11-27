/**
 * The account vectors' checks, shared by the device (account-vectors.test.ts,
 * over LocalDb) and the server (src/server/services/__tests__/
 * account-conformance.pg.test.ts, which runs the same steps through the v1
 * routes and reads the rows back as a device store). `checkState` holds a
 * store to a step's hand-derived expectations; `differingRows` holds two
 * stores equal row by row, on every field the engine keeps.
 */
import { dec } from "@retrospend/domain/precise-decimal";
import type {
	AccountVector,
	ExpectedAccount,
	ExpectedState,
	SeedAccount,
} from "./account-vectors";
import type {
	AccountRow,
	LegRow,
	RateSwitchRow,
	SnapshotRow,
} from "./accounts";
import { expectEqual } from "./conformance";
import { seededStore } from "./local-expense-create";
import { OWED_ID, type Reader, type TableRows } from "./port";
import { readDeviceFigures } from "./registry";

export const USER = "user";

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Decimals equal by value, null only to null. */
const sameDecimal = (a: string | null, b: string | null) =>
	a === null || b === null ? a === b : dec(a).eq(dec(b));

function expectDecimal(
	actual: string | null | undefined,
	expected: string | null,
	what: string,
) {
	if (!sameDecimal(actual ?? null, expected))
		throw new Error(`${what}: expected ${expected}, got ${actual ?? null}`);
}

function checkAccount(row: AccountRow, want: Partial<ExpectedAccount>) {
	const what = `account ${row.id}`;
	if (want.balance !== undefined)
		expectDecimal(row.balance, want.balance, `${what} balance`);
	if (want.exchangeRate !== undefined)
		expectDecimal(row.exchangeRate, want.exchangeRate, `${what} exchangeRate`);
	if (want.countedUnits !== undefined)
		expectDecimal(row.countedUnits, want.countedUnits, `${what} countedUnits`);
	if (want.exchangeRateType !== undefined)
		expectEqual(row.exchangeRateType, want.exchangeRateType, `${what} type`);
	if (want.closedAt !== undefined)
		expectEqual(
			row.closedAt?.toISOString() ?? null,
			want.closedAt,
			`${what} closedAt`,
		);
	if (want.currency !== undefined)
		expectEqual(row.currency, want.currency, `${what} currency`);
	if (want.version !== undefined)
		expectEqual(row.version, want.version, `${what} version`);
	if (want.name !== undefined) expectEqual(row.name, want.name, `${what} name`);
	if (want.interestRate !== undefined)
		expectDecimal(
			row.interestRate ?? null,
			want.interestRate,
			`${what} interestRate`,
		);
	if (want.minimumPayment !== undefined)
		expectDecimal(
			row.minimumPayment ?? null,
			want.minimumPayment,
			`${what} minimumPayment`,
		);
	if (want.dueDate !== undefined)
		expectEqual(row.dueDate ?? null, want.dueDate, `${what} dueDate`);
}

const need = <T>(row: T | undefined, what: string): T => {
	if (row === undefined) throw new Error(`${what} is missing`);
	return row;
};

/** Holds `store` to what a step's author derived by hand. */
export async function checkState(
	store: Reader,
	want: ExpectedState,
	now: Date,
): Promise<void> {
	for (const [id, expected] of Object.entries(want.accounts ?? {}))
		checkAccount(need(store.get("accounts", id), `account ${id}`), expected);
	for (const [id, expected] of Object.entries(want.legs ?? {})) {
		const leg = need(store.get("legs", id), `leg ${id}`);
		expectEqual(
			[leg.accountId, day(leg.date), leg.source, leg.homeCurrency],
			[
				expected.accountId,
				expected.date,
				expected.source,
				expected.homeCurrency,
			],
			`leg ${id}`,
		);
		expectDecimal(leg.amount, expected.amount, `leg ${id} amount`);
		expectDecimal(leg.homeAmount, expected.homeAmount, `leg ${id} homeAmount`);
	}
	for (const [accountId, n] of Object.entries(want.legCount ?? {}))
		expectEqual(
			store.list("legs").filter((l) => l.accountId === accountId).length,
			n,
			`legs of ${accountId}`,
		);
	for (const [accountId, n] of Object.entries(want.switchCount ?? {}))
		expectEqual(
			store.list("rateSwitches").filter((s) => s.accountId === accountId)
				.length,
			n,
			`rate switches of ${accountId}`,
		);
	for (const expected of want.snapshots ?? []) {
		const snapshot = need(
			store
				.list("snapshots")
				.find(
					(s) =>
						s.accountId === expected.accountId && day(s.date) === expected.day,
				),
			`snapshot of ${expected.accountId} on ${expected.day}`,
		);
		expectDecimal(snapshot.balance, expected.balance, "snapshot balance");
		expectEqual(
			snapshot.exchangeRateType,
			expected.exchangeRateType,
			"snapshot type",
		);
		if (expected.recordedAt !== undefined)
			expectEqual(
				snapshot.recordedAt.toISOString(),
				expected.recordedAt,
				"snapshot recordedAt",
			);
	}
	for (const [id, expected] of Object.entries(want.switches ?? {})) {
		const s = need(store.get("rateSwitches", id), `rate switch ${id}`);
		expectEqual(
			[s.accountId, day(s.from), s.type, s.previousType],
			[expected.accountId, expected.from, expected.type, expected.previousType],
			`rate switch ${id}`,
		);
	}
	if (want.netWorth !== undefined) {
		const home = store.get("settings", "user")?.homeCurrency;
		const read = await readDeviceFigures(
			store,
			USER,
			["netWorth"],
			{},
			() => now,
		);
		expectEqual(
			read.readings.get("netWorth"),
			[{ currency: home, minor: want.netWorth }],
			"net worth",
		);
	}
}

/** One comparison per column of a port row: a column added to the row type fails to compile until it is named here. */
type Columns<R> = { readonly [K in keyof R]-?: (a: R[K], b: R[K]) => boolean };

const exact = <T>(a: T, b: T) => (a ?? null) === (b ?? null);
const instant = (a: Date | null, b: Date | null) =>
	(a?.getTime() ?? null) === (b?.getTime() ?? null);
const decimal = (a: string | null | undefined, b: string | null | undefined) =>
	sameDecimal(a ?? null, b ?? null);
/** Compared elsewhere: rows are matched by id (a snapshot by account and day), so the id is the key. */
const byKey = () => true;

const ACCOUNT_COLUMNS: Columns<AccountRow> = {
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

const LEG_COLUMNS: Columns<LegRow> = {
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

const SNAPSHOT_COLUMNS: Columns<SnapshotRow> = {
	id: byKey,
	accountId: byKey,
	date: byKey,
	recordedAt: instant,
	balance: decimal,
	currency: exact,
	exchangeRateType: exact,
};

const SWITCH_COLUMNS: Columns<RateSwitchRow> = {
	id: byKey,
	accountId: exact,
	from: instant,
	type: exact,
	previousType: exact,
	createdAt: instant,
};

/** The names of the columns that differ. */
function differing<R extends object>(
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

const differingAccount = (d: AccountRow, s: AccountRow) =>
	differing(ACCOUNT_COLUMNS, d, s);
const differingLeg = (d: LegRow, s: LegRow) => differing(LEG_COLUMNS, d, s);
const differingSnapshot = (d: SnapshotRow, s: SnapshotRow) =>
	differing(SNAPSHOT_COLUMNS, d, s);
const differingSwitch = (d: RateSwitchRow, s: RateSwitchRow) =>
	differing(SWITCH_COLUMNS, d, s);

/**
 * The differences between the device's rows and the server's after the same
 * write, as `table id: field, field` lines; empty when they are equal. Compared
 * by id except snapshots, which are keyed by (account, day) because the server
 * names its own. A row on one side only is a line too. Every column the engine
 * keeps is compared except an account's `createdAt` (the database stamps it, the
 * device writes the instant it booked).
 */
export function differingRows(device: Reader, server: Reader): string[] {
	const lines: string[] = [];
	const byId = <T extends { id: string }>(
		table: string,
		a: readonly T[],
		b: readonly T[],
		diff: (x: T, y: T) => string[],
	) => {
		const other = new Map(b.map((r) => [r.id, r]));
		for (const row of a) {
			const match = other.get(row.id);
			if (!match) lines.push(`${table} ${row.id}: only on the device`);
			else {
				const fields = diff(row, match);
				if (fields.length > 0)
					lines.push(`${table} ${row.id}: ${fields.join(", ")}`);
			}
			other.delete(row.id);
		}
		for (const id of other.keys())
			lines.push(`${table} ${id}: only on the server`);
	};
	byId(
		"accounts",
		device.list("accounts"),
		server.list("accounts"),
		differingAccount,
	);
	byId("legs", device.list("legs"), server.list("legs"), differingLeg);
	byId(
		"rateSwitches",
		device.list("rateSwitches"),
		server.list("rateSwitches"),
		differingSwitch,
	);
	// A snapshot is one per account per day: its key stands in for an id.
	const key = (s: SnapshotRow) => `${s.accountId}:${day(s.date)}`;
	const keyed = (r: Reader) =>
		r.list("snapshots").map((s) => ({ ...s, id: key(s) }));
	byId("snapshots", keyed(device), keyed(server), differingSnapshot);
	return lines;
}

/** The rows a vector's seed puts in a store (the accounts and their absence of legs). */
export const seedRowOf = (a: SeedAccount): TableRows["accounts"] => ({
	id: a.id,
	name: a.name,
	type: a.type as TableRows["accounts"]["type"],
	currency: a.currency,
	balance: a.balance,
	exchangeRate: a.exchangeRate,
	exchangeRateType: a.exchangeRateType,
	closedAt: a.closedAt ?? null,
	createdAt: new Date("2026-10-01T00:00:00Z"),
	inBudget: null,
	countedUnits: a.countedUnits ?? "0",
	isLiquid: true,
	iconKind: null,
	version: 0,
});

/** The settings, rates and accounts of a vector as a device store. */
export async function seededAccountStore(vector: AccountVector) {
	const store = await seededStore(vector.seed);
	await store.transaction((tx) => {
		tx.put("owed", {
			id: OWED_ID,
			currency: vector.seed.homeCurrency,
			owedToYou: 0,
			youOwe: 0,
		});
		for (const a of vector.accounts ?? []) tx.put("accounts", seedRowOf(a));
	});
	return store;
}
