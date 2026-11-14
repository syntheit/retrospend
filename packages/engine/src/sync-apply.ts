/**
 * Applying what the server syncs to the device store (E2EE P16): the wire rows
 * of GET /sync/{expenses,categories,...} and the two snapshots
 * (GET /sync/shares, GET /sync/settings), as the port rows the figures read.
 * Production code for the pull loop; the parity harness drives the same
 * functions from real route responses.
 *
 * The engine depends on the domain only, so the wire shapes are declared here
 * as structural interfaces holding just the fields a table keeps. A pg test
 * assigns the contract's DTOs to them, so a contract change that drops or
 * retypes one of these fields fails to compile there.
 *
 * Every page is checked before its first write (a decimal that is not plain
 * decimal text, an instant that is not a date), so a bad page leaves the
 * transaction as it was and the caller can discard it. Rows apply by id, so a
 * page applied twice is the same as once; an id in `tombstones` is deleted.
 *
 * The budget book family (the personal book, its groups, envelopes, category
 * links, periods, closes, Wealth moves and payoff plan, plus movements and the
 * transfers a bill reads) applies the same way. A snapshot of `shares` may
 * carry the budget block (budget=1): it is kept as the pending snapshot beside
 * `owed`, and whether it can be read yet (cursors, valuation key) is the
 * reader's check, never made at apply time (see budget-snapshot.ts).
 *
 * The figures read two things the wire does not carry on the row itself: an
 * expense's category kind (an income category keeps it out of spending) and a
 * template's category (name, color, icon). Both come from the `categories`
 * table, so they are derived here whenever an expense, a template or a
 * category arrives, in any order: a category that arrives after its expense
 * fills the kind in, and a deleted one clears it.
 */
import type { AccountLegSource } from "@retrospend/domain/accounts/apply-legs";
import type { AssetType } from "@retrospend/domain/accounts/places";
import type { RecurringFrequency } from "@retrospend/domain/recurring";
import type { TableName, TableRows, Writer } from "./port";
import {
	BUDGET_SNAPSHOT_ID,
	InvalidInputError,
	OWED_ID,
	SETTINGS_ID,
} from "./port";
import {
	BOOK_ROWS,
	type BookWireOf,
	budgetSnapshotOf,
	type WireBudgetBlock,
} from "./sync-apply-book";
import { decimal, decimalOrNull, instant, instantOrNull } from "./sync-values";

export interface WireExpense {
	readonly id: string;
	readonly title: string;
	readonly amount: string;
	readonly currency: string;
	readonly date: string;
	readonly categoryId: string | null;
	readonly amountInUSD: string;
	readonly exchangeRate: string;
	readonly pricingSource: string;
	readonly location: string | null;
	readonly description: string | null;
	readonly status: string;
	readonly isAmortizedParent: boolean;
	readonly isAmortizedChild: boolean;
	readonly parentId: string | null;
	readonly amortizeMode: string;
	readonly keepInWealth: boolean;
	readonly recurringTemplateId: string | null;
	readonly budgetEnvelopeId: string | null;
	readonly excludeFromAnalytics: boolean;
	readonly direction: string;
	readonly entryKind: string;
	readonly inType: string | null;
	readonly rateType: string | null;
	readonly homeCurrency: string | null;
	readonly homeRate: string | null;
	readonly homeAmount: string | null;
}

export interface WireCategory {
	readonly id: string;
	readonly name: string;
	readonly color: string;
	readonly icon: string | null;
	readonly kind: string;
}

export interface WireTemplate {
	readonly id: string;
	readonly name: string;
	readonly amount: string;
	readonly currency: string;
	readonly categoryId: string | null;
	readonly direction: "OUT" | "IN";
	readonly amountMode: string;
	readonly frequency: RecurringFrequency;
	readonly nextDueDate: string;
	readonly anchorDay: number | null;
	readonly autoPay: boolean;
	readonly isActive: boolean;
}

export interface WireAccount {
	readonly id: string;
	readonly type: AssetType;
	readonly currency: string;
	readonly balance: string;
	readonly exchangeRate: string | null;
	readonly exchangeRateType: string | null;
	readonly interestRate: string | null;
	readonly minimumPayment: string | null;
	readonly dueDate: number | null;
	readonly closedAt: string | null;
	readonly createdAt: string;
}

export interface WireSnapshot {
	readonly id: string;
	readonly accountId: string;
	readonly date: string;
	readonly balance: string;
	readonly currency: string | null;
	readonly exchangeRateType: string | null;
	readonly recordedAt: string;
}

export interface WireLeg {
	readonly id: string;
	readonly accountId: string | null;
	readonly currency: string;
	readonly amount: string;
	readonly homeAmount: string | null;
	readonly homeCurrency: string | null;
	readonly date: string;
	readonly source: AccountLegSource;
	readonly createdAt: string;
}

export interface WireRateSwitch {
	readonly id: string;
	readonly accountId: string;
	readonly from: string;
	readonly type: string | null;
	readonly previousType: string | null;
	readonly createdAt: string;
}

export interface WireShare {
	readonly id: string;
	readonly expenseId: string;
	readonly shareAmount: string;
	readonly verificationStatus: string;
	readonly currency: string;
	readonly date: string;
	readonly projectId: string | null;
	readonly exchangeRate: string | null;
	readonly expenseCategoryId: string | null;
}

export interface WireMoney {
	readonly minor: number;
	readonly currency: string;
}

export interface WireShares {
	readonly items: readonly WireShare[];
	readonly owed:
		| { readonly owedToYou: WireMoney; readonly youOwe: WireMoney }
		| { readonly missingRates: readonly string[] };
	/**
	 * Only in a response to `budget=1`. Absent: not asked, the stored snapshot
	 * stays. Null: nothing to read on a device, the snapshot is cleared.
	 * Unavailable: this pull could not make it, the previous snapshot stays.
	 */
	readonly budget?: WireBudgetBlock | { readonly unavailable: true } | null;
}

export interface WireSettings {
	readonly homeCurrency: string;
	readonly timeZone: string;
	readonly startDay: number;
	readonly hiddenProjectIds: readonly string[];
	readonly defaultRateTypes: Readonly<Record<string, string>>;
}

/** The entities of a cursor pull the device applies, by the table they fill. */
export interface WireOf extends BookWireOf {
	expenses: WireExpense;
	categories: WireCategory;
	recurringTemplates: WireTemplate;
	accounts: WireAccount;
	snapshots: WireSnapshot;
	legs: WireLeg;
	rateSwitches: WireRateSwitch;
}

export type SyncEntity = keyof WireOf;

/** A page of a cursor pull: the rows that changed and the ids that were deleted. */
export interface SyncPage<Row> {
	readonly items: readonly Row[];
	readonly tombstones: readonly { readonly id: string }[];
}

/** The rows a page makes, built before anything is written, so a bad row refuses the page. */
type RowOf<E extends SyncEntity> = (
	wire: WireOf[E],
	categories: ReadonlyMap<string, TableRows["categories"]>,
) => TableRows[E];

const ROWS: { [E in SyncEntity]: RowOf<E> } = {
	...BOOK_ROWS,
	expenses: (w, categories) => ({
		id: w.id,
		status: w.status,
		direction: w.direction,
		entryKind: w.entryKind,
		inType: w.inType,
		isAmortizedParent: w.isAmortizedParent,
		isAmortizedChild: w.isAmortizedChild,
		parentId: w.parentId,
		amortizeMode: w.amortizeMode,
		keepInWealth: w.keepInWealth,
		recurringTemplateId: w.recurringTemplateId,
		budgetEnvelopeId: w.budgetEnvelopeId,
		excludeFromAnalytics: w.excludeFromAnalytics,
		categoryKind:
			w.categoryId === null
				? null
				: (categories.get(w.categoryId)?.kind ?? null),
		categoryId: w.categoryId,
		date: instant(w.date, `Expense ${w.id} date`),
		currency: w.currency,
		amount: decimal(w.amount, `Expense ${w.id} amount`),
		amountInUSD: decimal(w.amountInUSD, `Expense ${w.id} amountInUSD`),
		homeCurrency: w.homeCurrency,
		homeAmount: decimalOrNull(w.homeAmount, `Expense ${w.id} homeAmount`),
		title: w.title,
		description: w.description,
		location: w.location,
		pricingSource: w.pricingSource,
		exchangeRate: decimal(w.exchangeRate, `Expense ${w.id} exchangeRate`),
		rateType: w.rateType,
		homeRate: decimalOrNull(w.homeRate, `Expense ${w.id} homeRate`),
	}),
	categories: (w) => ({
		id: w.id,
		kind: w.kind,
		name: w.name,
		color: w.color,
		icon: w.icon,
	}),
	recurringTemplates: (w, categories) => ({
		id: w.id,
		name: w.name,
		amount: decimal(w.amount, `Template ${w.id} amount`),
		currency: w.currency,
		frequency: w.frequency,
		nextDueDate: instant(w.nextDueDate, `Template ${w.id} nextDueDate`),
		anchorDay: w.anchorDay,
		direction: w.direction,
		isActive: w.isActive,
		autoPay: w.autoPay,
		amountMode: w.amountMode,
		categoryId: w.categoryId,
		category: categoryRefOf(w.categoryId, categories),
	}),
	accounts: (w) => ({
		id: w.id,
		type: w.type,
		currency: w.currency,
		balance: decimal(w.balance, `Account ${w.id} balance`),
		exchangeRate: decimalOrNull(w.exchangeRate, `Account ${w.id} exchangeRate`),
		exchangeRateType: w.exchangeRateType,
		interestRate: decimalOrNull(w.interestRate, `Account ${w.id} interestRate`),
		minimumPayment: decimalOrNull(
			w.minimumPayment,
			`Account ${w.id} minimumPayment`,
		),
		dueDate: w.dueDate,
		closedAt: instantOrNull(w.closedAt, `Account ${w.id} closedAt`),
		createdAt: instant(w.createdAt, `Account ${w.id} createdAt`),
	}),
	snapshots: (w) => ({
		id: w.id,
		accountId: w.accountId,
		date: instant(w.date, `Snapshot ${w.id} date`),
		recordedAt: instant(w.recordedAt, `Snapshot ${w.id} recordedAt`),
		balance: decimal(w.balance, `Snapshot ${w.id} balance`),
		currency: w.currency,
		exchangeRateType: w.exchangeRateType,
	}),
	legs: (w) => ({
		id: w.id,
		accountId: w.accountId,
		currency: w.currency,
		date: instant(w.date, `Leg ${w.id} date`),
		createdAt: instant(w.createdAt, `Leg ${w.id} createdAt`),
		amount: decimal(w.amount, `Leg ${w.id} amount`),
		source: w.source,
		homeAmount: decimalOrNull(w.homeAmount, `Leg ${w.id} homeAmount`),
		homeCurrency: w.homeCurrency,
	}),
	rateSwitches: (w) => ({
		id: w.id,
		accountId: w.accountId,
		from: instant(w.from, `Rate switch ${w.id} from`),
		type: w.type,
		previousType: w.previousType,
		createdAt: instant(w.createdAt, `Rate switch ${w.id} createdAt`),
	}),
};

function categoryRefOf(
	categoryId: string | null,
	categories: ReadonlyMap<string, TableRows["categories"]>,
): TableRows["recurringTemplates"]["category"] {
	const c = categoryId === null ? undefined : categories.get(categoryId);
	return c ? { id: c.id, name: c.name, color: c.color, icon: c.icon } : null;
}

const categoriesOf = (tx: Writer) =>
	new Map(tx.list("categories").map((c) => [c.id, c]));

/**
 * Applies one page of `entity` to `tx`: puts its rows, deletes its tombstones,
 * and, when categories changed, re-derives the category fields of the expenses
 * and templates that name them. A bad row throws InvalidInputError before any
 * write.
 */
export function applySyncPage<E extends SyncEntity>(
	tx: Writer,
	entity: E,
	page: SyncPage<WireOf[E]>,
): void {
	const categories = categoriesOf(tx);
	const make = ROWS[entity] as RowOf<E>;
	const rows = page.items.map((item) => make(item, categories));
	if (new Set(rows.map((r) => r.id)).size !== rows.length)
		throw new InvalidInputError(`The ${entity} page repeats an id`);
	for (const row of rows) tx.put(entity, row);
	for (const t of page.tombstones) tx.delete(entity, t.id);
	if (entity === "categories")
		rederive(
			tx,
			new Set([...rows.map((r) => r.id), ...page.tombstones.map((t) => t.id)]),
		);
}

/** The expenses and templates that name one of `changed` get their category fields again. */
function rederive(tx: Writer, changed: ReadonlySet<string>): void {
	const categories = categoriesOf(tx);
	for (const e of tx.list("expenses")) {
		if (e.categoryId == null || !changed.has(e.categoryId)) continue;
		const categoryKind = categories.get(e.categoryId)?.kind ?? null;
		if (categoryKind !== e.categoryKind)
			tx.put("expenses", { ...e, categoryKind });
	}
	for (const t of tx.list("recurringTemplates")) {
		if (t.categoryId == null || !changed.has(t.categoryId)) continue;
		tx.put("recurringTemplates", {
			...t,
			category: categoryRefOf(t.categoryId, categories),
		});
	}
}

/** Deletes every row of `table` the snapshot no longer holds, then puts the rest. */
function replaceTable<T extends TableName>(
	tx: Writer,
	table: T,
	rows: readonly TableRows[T][],
): void {
	const keep = new Set(rows.map((r) => r.id));
	for (const old of tx.list(table))
		if (!keep.has(old.id)) tx.delete(table, old.id);
	for (const row of rows) tx.put(table, row);
}

/**
 * Applies GET /sync/shares: the `shares` table becomes exactly the rows sent,
 * and the `owed` row the totals sent, both in `tx`, with the budget snapshot
 * when the body asks for it (see WireShares.budget; a block lands in
 * budgetSnapshotPending, null clears both snapshots). The whole body is checked
 * first. Owed to you and You owe must be in one currency.
 */
export function applySharesSnapshot(tx: Writer, body: WireShares): void {
	const rows: TableRows["shares"][] = body.items.map((w) => ({
		id: w.id,
		expenseId: w.expenseId,
		shareAmount: decimal(w.shareAmount, `Share ${w.id} amount`),
		verificationStatus: w.verificationStatus,
		currency: w.currency,
		date: instant(w.date, `Share ${w.id} date`),
		projectId: w.projectId,
		exchangeRate: decimalOrNull(w.exchangeRate, `Share ${w.id} exchangeRate`),
		categoryId: w.expenseCategoryId,
	}));
	if (new Set(rows.map((r) => r.id)).size !== rows.length)
		throw new InvalidInputError("The shares snapshot repeats an id");
	const { owed } = body;
	let owedRow: TableRows["owed"];
	if ("missingRates" in owed)
		owedRow = { id: OWED_ID, missingRates: [...owed.missingRates] };
	else {
		if (owed.owedToYou.currency !== owed.youOwe.currency)
			throw new InvalidInputError("Owed is in two currencies");
		for (const m of [owed.owedToYou, owed.youOwe])
			if (!Number.isSafeInteger(m.minor) || m.minor < 0)
				throw new InvalidInputError("Owed is not a count of minor units");
		owedRow = {
			id: OWED_ID,
			currency: owed.owedToYou.currency,
			owedToYou: owed.owedToYou.minor,
			youOwe: owed.youOwe.minor,
		};
	}
	// Checked before the first write, like the rest of the body.
	const snapshot =
		body.budget === undefined || body.budget === null
			? undefined
			: budgetSnapshotOf(body.budget);
	replaceTable(tx, "shares", rows);
	tx.put("owed", owedRow);
	if (body.budget === null) {
		tx.delete("budgetSnapshot", BUDGET_SNAPSHOT_ID);
		tx.delete("budgetSnapshotPending", BUDGET_SNAPSHOT_ID);
	}
	// A new block waits as pending: the active one is the last whose cursor gate
	// passed and keeps serving until promotePendingBudget moves the new one in.
	// Unavailable keeps both, so a failed pull leaves a device the last good block.
	else if (snapshot) tx.put("budgetSnapshotPending", snapshot);
}

/** Applies GET /sync/settings: the one settings row. An empty `defaultRateTypes` is left off the row. */
export function applySettings(tx: Writer, body: WireSettings): void {
	// 1 to 28: the contract's cap, so every month has the day.
	if (
		!Number.isInteger(body.startDay) ||
		body.startDay < 1 ||
		body.startDay > 28
	)
		throw new InvalidInputError("Settings has no valid start day");
	tx.put("settings", {
		id: SETTINGS_ID,
		homeCurrency: body.homeCurrency,
		timeZone: body.timeZone,
		startDay: body.startDay,
		hiddenProjectIds: [...body.hiddenProjectIds],
		...(Object.keys(body.defaultRateTypes).length > 0
			? { defaultRateTypes: { ...body.defaultRateTypes } }
			: {}),
	});
}
