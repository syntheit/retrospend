/**
 * The transfer vectors' checks, shared by the device (transfer-vectors.test.ts,
 * over LocalDb) and the server (src/server/services/__tests__/
 * transfer-conformance.pg.test.ts, which runs the same steps through the v1
 * routes and reads the rows back as a device store). `checkTransferState`
 * holds a store to a step's hand-derived expectations; `differingTransferRows`
 * holds two stores equal row by row, on every field the engine keeps.
 */
import { bookValuationKey } from "@retrospend/domain/envelope/book-valuation-key";
import { dec } from "@retrospend/domain/precise-decimal";
import {
	ACCOUNT_COLUMNS,
	byKey,
	day,
	differing,
	exact,
	expectDecimal,
	instant,
	LEG_COLUMNS,
	need,
	SNAPSHOT_COLUMNS,
	seededAccountStore,
	USER,
} from "./account-conformance";
import { expectEqual } from "./conformance";
import { fixtureRow } from "./fixtures";
import type { Reader, TableRows } from "./port";
import { readDeviceFigures } from "./registry";
import type {
	ExpectedFee,
	ExpectedTransferState,
	TransferVector,
} from "./transfer-vector-types";
import { type Columns, TRANSFER_COLUMNS } from "./wealth-columns";

/** A device store holding the vector's settings, rates, accounts and budget book. */
export async function seededTransferStore(vector: TransferVector) {
	const store = await seededAccountStore(vector);
	if (vector.budget === "none") return store;
	const book = {
		...fixtureRow("budgetBooks", "book-1"),
		currency: vector.budget.currency,
		defaultEnvelopeId: "env-1",
	};
	const period = fixtureRow("bookPeriods", "period-1");
	await store.transaction((tx) => {
		tx.put("budgetBooks", book);
		tx.put("bookPeriods", { ...period, bookId: book.id });
		// The block the device would hold once its pull's gate passed: made for this book as it is.
		tx.put("budgetSnapshot", {
			...fixtureRow("budgetSnapshot", "budget"),
			bookId: book.id,
			valuationKey: bookValuationKey({
				currency: book.currency,
				timeZone: book.timeZone,
				startDate: book.startDate,
				periods: [period],
			}),
		});
	});
	return store;
}

function checkFee(row: TableRows["expenses"], want: ExpectedFee, id: string) {
	const what = `fee expense ${id}`;
	expectEqual(
		[row.title, row.description, row.currency, row.homeCurrency],
		[want.title, want.description, want.currency, want.homeCurrency],
		what,
	);
	expectEqual(
		[row.status, row.direction, row.entryKind, row.categoryId ?? null],
		["FINALIZED", "OUT", "STANDARD", null],
		`${what} kind`,
	);
	expectEqual(row.date.toISOString(), want.date, `${what} date`);
	expectEqual(row.rateType ?? null, want.rateType, `${what} rateType`);
	expectDecimal(String(row.amount), want.amount, `${what} amount`);
	expectDecimal(String(row.amountInUSD), want.amountInUSD, `${what} USD`);
	expectDecimal(row.exchangeRate ?? null, want.exchangeRate, `${what} rate`);
	expectDecimal(
		row.homeRate === undefined || row.homeRate === null
			? null
			: String(row.homeRate),
		want.homeRate,
		`${what} homeRate`,
	);
	expectDecimal(
		row.homeAmount === null ? null : String(row.homeAmount),
		want.homeAmount,
		`${what} homeAmount`,
	);
}

/** Holds `store` to what a step's author derived by hand. `fees: false` skips the fee expense's booked fields, which only a device store keeps. */
export async function checkTransferState(
	store: Reader,
	want: ExpectedTransferState,
	now: Date,
	opts: { fees: boolean } = { fees: true },
): Promise<void> {
	for (const [id, expected] of Object.entries(want.accounts ?? {})) {
		const row = need(store.get("accounts", id), `account ${id}`);
		expectDecimal(row.balance, expected.balance, `account ${id} balance`);
		expectDecimal(
			row.countedUnits,
			expected.countedUnits,
			`account ${id} counted`,
		);
	}
	for (const [id, expected] of Object.entries(want.transfers ?? {})) {
		const row = need(store.get("transfers", id), `transfer ${id}`);
		expectEqual(
			[
				row.kind,
				day(row.date),
				row.fromAccountId,
				row.toAccountId,
				row.toCurrency,
				row.feeExpenseId,
				row.note,
			],
			[
				expected.kind,
				expected.date,
				expected.fromAccountId,
				expected.toAccountId,
				expected.toCurrency,
				expected.feeExpenseId,
				expected.note,
			],
			`transfer ${id}`,
		);
		expectDecimal(row.fromAmount, expected.fromAmount, `transfer ${id} from`);
		expectDecimal(row.toAmount, expected.toAmount, `transfer ${id} to`);
		expectDecimal(
			row.countedFromUnits,
			expected.countedFromUnits,
			`transfer ${id} counted from`,
		);
		expectDecimal(
			row.countedToUnits,
			expected.countedToUnits,
			`transfer ${id} counted to`,
		);
	}
	for (const [id, expected] of Object.entries(want.legs ?? {})) {
		const leg = need(store.get("legs", id), `leg ${id}`);
		expectEqual(
			[
				leg.accountId,
				leg.currency,
				day(leg.date),
				leg.source,
				leg.homeCurrency,
				leg.transferId,
				leg.expenseId,
			],
			[
				expected.accountId,
				expected.currency,
				expected.date,
				expected.source,
				expected.homeCurrency,
				expected.transferId,
				expected.expenseId,
			],
			`leg ${id}`,
		);
		expectDecimal(leg.amount, expected.amount, `leg ${id} amount`);
		expectDecimal(leg.homeAmount, expected.homeAmount, `leg ${id} home`);
	}
	if (want.legCount !== undefined)
		expectEqual(store.list("legs").length, want.legCount, "leg count");
	if (opts.fees)
		for (const [id, expected] of Object.entries(want.expenses ?? {}))
			checkFee(need(store.get("expenses", id), `expense ${id}`), expected, id);
	else
		for (const id of Object.keys(want.expenses ?? {}))
			need(store.get("expenses", id), `expense ${id}`);
	for (const id of want.gone?.transfers ?? [])
		expectEqual(
			store.get("transfers", id) === undefined,
			true,
			`transfer ${id} gone`,
		);
	for (const id of want.gone?.legs ?? [])
		expectEqual(store.get("legs", id) === undefined, true, `leg ${id} gone`);
	for (const id of want.gone?.expenses ?? [])
		expectEqual(
			store.get("expenses", id) === undefined,
			true,
			`expense ${id} gone`,
		);
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

/** The columns of an expense both a device's booking and the server's read have (the fee's booked rate is held by the vector's own values). */
const EXPENSE_COLUMNS: Columns<
	Pick<
		TableRows["expenses"],
		| "id"
		| "status"
		| "direction"
		| "entryKind"
		| "inType"
		| "isAmortizedParent"
		| "excludeFromAnalytics"
		| "categoryKind"
		| "categoryId"
		| "date"
		| "currency"
		| "amount"
		| "amountInUSD"
		| "homeCurrency"
		| "homeAmount"
	>
> = {
	id: byKey,
	status: exact,
	direction: exact,
	entryKind: exact,
	inType: exact,
	isAmortizedParent: exact,
	excludeFromAnalytics: exact,
	categoryKind: exact,
	categoryId: exact,
	date: instant,
	currency: exact,
	amount: (a, b) => dec(a).eq(dec(b)),
	amountInUSD: (a, b) => dec(a).eq(dec(b)),
	homeCurrency: exact,
	homeAmount: (a, b) =>
		a === null || b === null ? a === b : dec(a).eq(dec(b)),
};

const dayOf = (s: TableRows["snapshots"]) => `${s.accountId}:${day(s.date)}`;

/**
 * The differences between the device's rows and the server's after the same
 * write, as `table id: field, field` lines; empty when equal. Accounts, legs,
 * snapshots, transfers and the expenses (every field both sides keep); a row
 * on one side only is a line too. Snapshots are keyed by (account, day).
 */
export function differingTransferRows(
	device: Reader,
	server: Reader,
): string[] {
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
	byId("accounts", device.list("accounts"), server.list("accounts"), (d, s) =>
		differing(ACCOUNT_COLUMNS, d, s),
	);
	byId("legs", device.list("legs"), server.list("legs"), (d, s) =>
		differing(LEG_COLUMNS, d, s),
	);
	byId(
		"transfers",
		device.list("transfers"),
		server.list("transfers"),
		(d, s) => differing(TRANSFER_COLUMNS, d, s),
	);
	byId("expenses", device.list("expenses"), server.list("expenses"), (d, s) =>
		differing(EXPENSE_COLUMNS, d, s),
	);
	const keyed = (r: Reader) =>
		r.list("snapshots").map((s) => ({ ...s, id: dayOf(s) }));
	byId("snapshots", keyed(device), keyed(server), (d, s) =>
		differing(SNAPSHOT_COLUMNS, d, s),
	);
	return lines;
}
