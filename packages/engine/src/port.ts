/**
 * The storage port of the device engine: the rows the device figures and the
 * preview runner read and write, as plain in-memory values. Every table's row
 * is the shape the matching loader in @retrospend/domain takes (an id on top
 * where the domain row has none), so `store.list("expenses")` feeds
 * spentInputsFromRows and the others directly. A store holds decrypted rows;
 * persistence and sealing sit under it, never in the port.
 *
 * Rows are immutable values. A store never mutates one and a caller never
 * should: copy-on-write snapshots depend on it.
 */
import type {
	AccountRow,
	LegRow,
	RateSwitchRow,
	SnapshotRow,
} from "@retrospend/domain/accounts/account-figures";
import type { MovementRow } from "@retrospend/domain/envelope/inputs-port";
import type { StoredRateRow } from "@retrospend/domain/money";
import type { RecurringTemplateRow } from "@retrospend/domain/recurring-view";
import type { SpentExpenseRow, SpentShareRow } from "@retrospend/domain/spent";
import type {
	AccountTerms,
	BookPeriodRow,
	BudgetBookRow,
	BudgetSnapshotRow,
	EnvelopeCategoryRow,
	EnvelopeGroupRow,
	EnvelopeRow,
	ExpenseBookDetail,
	MonthCloseRow,
	PayoffPlanRow,
	TransferRow,
	WealthTransferRow,
} from "./book-rows";

export interface WithId {
	readonly id: string;
}

/** The user's settings the figures read, one row (id "user"). */
export interface SettingsRow extends WithId {
	readonly homeCurrency: string;
	readonly timeZone: string;
	/** First day of the fiscal month. */
	readonly startDay: number;
	/** Projects hidden from reports. */
	readonly hiddenProjectIds: readonly string[];
	/** The preferred rate type per home currency ({"ARS": "blue"}); absent or empty: the built-in default. */
	readonly defaultRateTypes?: Readonly<Record<string, string>>;
}

/**
 * What the last rate sync (applyDailyTable) left, one row (id "rates"): the
 * server's `asOf` of the table now in `rates`, null when it was empty. Never a
 * figure input; a device reads it to show how fresh its rates are.
 */
export interface RateSyncRow extends WithId {
	readonly asOf: string | null;
}

/**
 * What an expense row keeps beyond the fields the spending rules read: its
 * text and both legs of its rate, as the server stores them. Optional, since
 * rows of figures-only fixtures and older rows have none; a row the device
 * creates has all the rate fields.
 */
export interface ExpenseDetail {
	readonly title?: string;
	readonly description?: string | null;
	readonly location?: string | null;
	readonly pricingSource?: string;
	/** Entry leg, units per USD (crypto: USD per unit), at the column's 6 decimals. */
	readonly exchangeRate?: string;
	/** The rate type both legs were booked at, or null. */
	readonly rateType?: string | null;
	/** Units of homeCurrency per 1 unit of currency, at 12 decimals. */
	readonly homeRate?: string | null;
}

/**
 * A category the user owns, as a sync sends it. The figures never read it
 * directly: the sync layer joins `kind` onto each expense and the name, color
 * and icon onto each template when either arrives, in any order, so a loader
 * always finds them on the row it reads.
 */
export interface CategoryRow extends WithId {
	/** "EXPENSE" or "INCOME"; an income category never counts as spending. */
	readonly kind: string;
	readonly name: string;
	readonly color: string;
	readonly icon: string | null;
}

/**
 * What a template row keeps beyond the fields the view reads: the id of its
 * category, so the sync layer can fill `category` when the category arrives
 * after the template. Rows of figures-only fixtures have none.
 */
export interface TemplateDetail {
	readonly categoryId?: string | null;
}

/**
 * Owed to you and You owe in the home currency as the server read them, or the
 * currencies that kept them out, one row (id "owed"). The server computes
 * shared money, so a device takes it from a sync snapshot (GET /sync/shares)
 * and the figures read it from the store like any other table: a preview sees
 * it through its transaction, and a device write never changes it.
 */
export type OwedRow = WithId &
	(
		| {
				/** The currency of both totals: the home currency of the pull. */
				readonly currency: string;
				/** Minor units, never negative. */
				readonly owedToYou: number;
				readonly youOwe: number;
		  }
		| { readonly missingRates: readonly string[] }
	);

/** One of your participations in an expense; `expenseId` ties it to the expense row it belongs to. */
export type ShareRow = Readonly<SpentShareRow> &
	WithId & { readonly expenseId: string };

/** Each table's row type. A new figure's loader adds its table here. */
export interface TableRows {
	expenses: Readonly<SpentExpenseRow> &
		WithId &
		ExpenseDetail &
		ExpenseBookDetail;
	shares: ShareRow;
	legs: LegRow;
	snapshots: SnapshotRow & WithId;
	accounts: AccountRow & AccountTerms;
	rateSwitches: RateSwitchRow & WithId;
	rates: Readonly<StoredRateRow> & WithId;
	rateSync: RateSyncRow;
	budgetMovements: Readonly<MovementRow> & WithId & { readonly bookId: string };
	recurringTemplates: Readonly<RecurringTemplateRow> & TemplateDetail;
	categories: CategoryRow;
	owed: OwedRow;
	settings: SettingsRow;
	budgetBooks: BudgetBookRow;
	envelopeGroups: EnvelopeGroupRow;
	envelopes: EnvelopeRow;
	envelopeCategories: EnvelopeCategoryRow;
	bookPeriods: BookPeriodRow;
	monthCloses: MonthCloseRow;
	wealthTransfers: WealthTransferRow;
	payoffPlans: PayoffPlanRow;
	transfers: TransferRow;
	budgetSnapshot: BudgetSnapshotRow;
}

export type TableName = keyof TableRows;

export const TABLE_NAMES = [
	"expenses",
	"shares",
	"legs",
	"snapshots",
	"accounts",
	"rateSwitches",
	"rates",
	"rateSync",
	"budgetMovements",
	"recurringTemplates",
	"categories",
	"owed",
	"settings",
	"budgetBooks",
	"envelopeGroups",
	"envelopes",
	"envelopeCategories",
	"bookPeriods",
	"monthCloses",
	"wealthTransfers",
	"payoffPlans",
	"transfers",
	"budgetSnapshot",
] as const satisfies readonly TableName[];

/** Reads. Lists come back ordered by id, so a loader never depends on insert order. */
export interface Reader {
	get<T extends TableName>(table: T, id: string): TableRows[T] | undefined;
	list<T extends TableName>(table: T): readonly TableRows[T][];
}

/** A frozen view of the store at one moment; later commits never change it. */
export type Snapshot = Reader;

export interface Writer extends Reader {
	/**
	 * Insert or replace by id. Rows are copied in, so changing the object
	 * afterwards changes nothing. Settings has one row: any id but "user"
	 * throws InvalidInputError.
	 */
	put<T extends TableName>(table: T, row: TableRows[T]): void;
	/** True when the row existed. */
	delete(table: TableName, id: string): boolean;
}

/**
 * A transaction. Reads see its own writes; nothing reaches the store before
 * `commit`. After commit or rollback every call throws TransactionError.
 */
export interface Tx extends Writer {
	commit(): Promise<void>;
	/** Drops the writes; the store is untouched. Safe to call twice. */
	rollback(): void;
	/**
	 * A nested transaction over this one's view. Its commit folds its writes
	 * into this transaction (not the store); its rollback drops only them.
	 * This transaction is unusable until the savepoint ends.
	 */
	savepoint(): Tx;
}

export interface Store extends Reader {
	snapshot(): Snapshot;
	/**
	 * Starts a transaction. Top-level transactions run one at a time in call
	 * order: `begin` resolves when every earlier one has committed or rolled
	 * back, and the new one reads what they committed. Never await `begin`
	 * or `transaction` from inside a transaction; use `tx.savepoint()`. The
	 * store throws TransactionError for the case it can see (a call made
	 * while a `transaction` callback is still running its synchronous part)
	 * and, when `beginTimeoutMs` is set, for any `begin` that waits longer.
	 */
	begin(): Promise<Tx>;
	/** Runs `fn` in a transaction: commit when it returns, rollback when it throws. */
	transaction<R>(fn: (tx: Tx) => R | Promise<R>): Promise<R>;
}

/** What a commit changes in one row; `row` is null for a delete. */
export interface Change {
	readonly table: TableName;
	readonly id: string;
	readonly row: TableRows[TableName] | null;
}

export class TransactionError extends Error {
	override readonly name = "TransactionError";
}

/** The one row of the settings table. */
export const SETTINGS_ID = "user";

/** The one row of the rateSync table. */
export const RATE_SYNC_ID = "rates";

/** The one row of the owed table. */
export const OWED_ID = "owed";

/** The one row of the budgetSnapshot table. */
export const BUDGET_SNAPSHOT_ID = "budget";

/** Tables that hold exactly one row, and its id; any other id is refused. */
export const SINGLE_ROW_IDS: Partial<Record<TableName, string>> = {
	settings: SETTINGS_ID,
	rateSync: RATE_SYNC_ID,
	owed: OWED_ID,
	budgetSnapshot: BUDGET_SNAPSHOT_ID,
};

/** A write the port refuses: the row breaks a rule of its table. */
export class InvalidInputError extends Error {
	override readonly name = "InvalidInputError";
}
