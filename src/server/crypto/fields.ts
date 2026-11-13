/**
 * The user-text field map (E2EE lane D11, docs/roadmap/e2ee-d11-design.md
 * section 1.1): every database column that holds a person's free text, the
 * Prisma model it belongs to, and which key seals it.
 *
 * It is written by hand because the contract names in USER_TEXT_FIELDS
 * (`person.name`, `payment.method`) are not model or column names. A model's
 * columns are fields of the model, and the SQL names are the Prisma names
 * (no field uses `@map`), so the AAD for a cell is
 * `{ table, column, rowId }` with the table from here.
 *
 * Key classes, final per the owner's answers (design doc, Revision 2, and
 * the 2026-11-11 change in docs/roadmap/e2ee-d11-pr3.md section 2.1):
 * - `user`: personal text, sealed with the row owner's data key. Every model
 *   with a user-class column has an owner column, `userId` unless the entry
 *   names another in `owner` (a ghost person is owned by `createdById`), and
 *   the reader opens the cell with that owner's key; a reader who is not the
 *   owner gets a typed fallback, never another key's attempt. The fallback
 *   is "" unless the column is in `nullWhenHidden`, where it is null.
 * - `instance`: text other people read (shared expenses, projects, shared
 *   budget books and their income rules and wealth moves, co-participant
 *   names, admin views, better-auth reads), sealed with the instance key.
 *   `income_rule` has no owner column and every book member reads it, so its
 *   text and `wealth_transfer.note` are instance class.
 *
 * Reads open sealed cells through this map (field-open.ts); nothing seals
 * yet. `fields.test.ts` holds it in step with the control-character scan
 * list, the declared contract fields and the Prisma schema, so a new text
 * column fails a test until it is placed here.
 */

export type KeyClass = "user" | "instance";

/** The column that names a row's owner, and the relation it backs (for `connect`). */
export interface OwnerColumn {
	readonly column: string;
	readonly relation: string;
}

/** Owner of every model that does not name one. */
const DEFAULT_OWNER: OwnerColumn = { column: "userId", relation: "user" };

export interface ModelFields {
	/** The SQL table name (the model's `@@map`). */
	readonly table: string;
	/** Column (and Prisma field) name to the key class that seals it. */
	readonly columns: Readonly<Record<string, KeyClass>>;
	/** Owner of a user-class cell; `userId` and `user` when absent. */
	readonly owner?: OwnerColumn;
	/** User-class columns that read null, not "", for a reader who holds no key for them. */
	readonly nullWhenHidden?: readonly string[];
}

export const FIELD_MAP = {
	Apikey: { table: "apikey", columns: { name: "instance" } },
	AssetAccount: { table: "asset_account", columns: { name: "user" } },
	BillingPeriod: { table: "billing_period", columns: { label: "instance" } },
	BudgetBook: { table: "budget_book", columns: { name: "instance" } },
	BudgetMovement: { table: "budget_movement", columns: { note: "instance" } },
	Category: { table: "category", columns: { name: "user" } },
	Envelope: { table: "envelope", columns: { name: "instance" } },
	EnvelopeGroup: { table: "envelope_group", columns: { name: "instance" } },
	EnvelopeChange: {
		table: "envelope_change",
		columns: { previousName: "instance" },
	},
	// Crash text the app sent for support. Instance class: the admin reads
	// every user's reports (retention-sweep.ts keeps them 30 days).
	ErrorReport: {
		table: "error_report",
		columns: { message: "instance", stack: "instance" },
	},
	Expense: {
		table: "expense",
		columns: { title: "user", description: "user", location: "user" },
	},
	ExportJob: { table: "export_job", columns: { fileName: "user" } },
	Feedback: {
		table: "feedback",
		columns: { message: "instance", adminNote: "instance" },
	},
	FixRequest: {
		table: "fix_request",
		columns: { message: "instance", reply: "instance" },
	},
	GuestSession: { table: "guest_session", columns: { name: "instance" } },
	ImportJob: { table: "import_job", columns: { fileName: "user" } },
	IncomeRule: {
		table: "income_rule",
		columns: { name: "instance", matchTitle: "instance" },
	},
	Payment: {
		table: "payment",
		columns: { note: "instance", paymentMethod: "instance" },
	},
	PaymentMethod: {
		table: "payment_method",
		columns: { label: "instance", identifier: "instance" },
	},
	Project: {
		table: "project",
		columns: { name: "instance", description: "instance" },
	},
	RecurringTemplate: {
		table: "recurring_template",
		columns: { name: "user", paymentSource: "user", websiteUrl: "user" },
	},
	PushDevice: { table: "push_device", columns: { deviceName: "user" } },
	Settlement: {
		table: "settlement",
		columns: {
			note: "instance",
			paymentMethod: "instance",
			rejectedReason: "instance",
		},
	},
	ShadowProfile: { table: "shadow_profile", columns: { name: "instance" } },
	SharedTransaction: {
		table: "shared_transaction",
		columns: { description: "instance", notes: "instance" },
	},
	SplitParticipant: {
		table: "split_participant",
		columns: { rejectionReason: "instance" },
	},
	Transfer: { table: "transfer", columns: { note: "user" } },
	User: { table: "user", columns: { name: "instance" } },
	WealthTransfer: { table: "wealth_transfer", columns: { note: "instance" } },
	Webhook: { table: "webhook", columns: { name: "instance" } },
} as const satisfies Record<string, ModelFields>;

/** A Prisma model name that has at least one mapped column. */
export type MappedModel = keyof typeof FIELD_MAP;

type ModelEntries = Readonly<Record<string, ModelFields | undefined>>;

/**
 * The lookups over the map. Built once for FIELD_MAP; a test may swap in a
 * map with an extra model (`addModelsForTests`) to exercise a rule no
 * real model uses yet.
 */
interface Index {
	models: ModelEntries;
	byTable: ReadonlyMap<string, string>;
}

const indexOf = (models: ModelEntries): Index => ({
	models,
	byTable: new Map(
		Object.entries(models).flatMap(([model, fields]) =>
			fields ? [[fields.table, model] as const] : [],
		),
	),
});

let index: Index = indexOf(FIELD_MAP);

/** The map entry for a Prisma model name, or undefined when it holds no user text. */
export function fieldsOfModel(model: string): ModelFields | undefined {
	return Object.hasOwn(index.models, model) ? index.models[model] : undefined;
}

/** The Prisma model that owns a SQL table, or undefined when it holds no user text. */
export function modelOfTable(table: string): MappedModel | undefined {
	return index.byTable.get(table) as MappedModel | undefined;
}

/**
 * The owner column of a model's user-class cells. A model that only has JSON
 * cells (IdempotencyKey) is not in the map and is owned by `userId`.
 */
export function ownerOfModel(model: string): OwnerColumn {
	return fieldsOfModel(model)?.owner ?? DEFAULT_OWNER;
}

/** The owner column of a SQL table's user-class cells. */
export function ownerOfTable(table: string): OwnerColumn {
	const model = modelOfTable(table);
	return model ? ownerOfModel(model) : DEFAULT_OWNER;
}

/** Whether a hidden cell of this column reads null instead of "". */
export function nullWhenHidden(table: string, column: string): boolean {
	const model = modelOfTable(table);
	return (
		(model && fieldsOfModel(model)?.nullWhenHidden?.includes(column)) === true
	);
}

/**
 * Adds `extra` models to the map, for tests of a rule no real model uses yet,
 * and returns the call that takes them out again. Only this module's lookups
 * are rebuilt (other modules build constants from FIELD_MAP at import), so a
 * real model may not be replaced, and a model graph is built after this call.
 */
export function addModelsForTests(
	extra: Readonly<Record<string, ModelFields>>,
): () => void {
	const taken = Object.keys(extra).filter((m) => Object.hasOwn(FIELD_MAP, m));
	if (taken.length > 0)
		throw new Error(`addModelsForTests may not replace ${taken.join(", ")}`);
	const before = index;
	index = indexOf({ ...FIELD_MAP, ...extra });
	cellClasses = buildCellClasses();
	return () => {
		index = before;
		cellClasses = buildCellClasses();
	};
}

/** The key class that seals a cell, looked up by Prisma model and field. */
export function keyClassOfField(
	model: string,
	field: string,
): KeyClass | undefined {
	const columns = fieldsOfModel(model)?.columns;
	return columns && Object.hasOwn(columns, field) ? columns[field] : undefined;
}

/** The key class that seals a cell, looked up by SQL table and column. */
export function keyClassOfColumn(
	table: string,
	column: string,
): KeyClass | undefined {
	const model = modelOfTable(table);
	return model ? keyClassOfField(model, column) : undefined;
}

/** Every mapped cell as `[table, column, class]`, in map order. */
export function mappedColumns(): ReadonlyArray<
	readonly [table: string, column: string, keyClass: KeyClass]
> {
	return (Object.keys(FIELD_MAP) as MappedModel[]).flatMap((model) => {
		const { table, columns } = FIELD_MAP[model] as ModelFields;
		return Object.entries(columns).map(
			([column, keyClass]) => [table, column, keyClass] as const,
		);
	});
}

/**
 * A JSON column that holds user text (E2EE D11 PR 8, docs/roadmap/
 * e2ee-d11-pr7-8.md), sealed by the same extension under the AAD of the
 * row's own id (json-cells.ts):
 * - `body`: the whole value, stored as `{ "sealed": "<ciphertext>" }`;
 * - `leaves`: only the strings at `paths` (dot paths, `*` for each array
 *   item), each in place under the column `<column>:<concrete path>`, so the
 *   rest stays readable by SQL.
 * Kept apart from FIELD_MAP, whose columns are text. A server older than
 * PR 8.1 reads a sealed body as `{ sealed }` (a replay returns it, an undo
 * fails), so once one is written that is the rollback floor.
 */
export type JsonCell =
	| { readonly mode: "body"; readonly cls: KeyClass }
	| {
			readonly mode: "leaves";
			readonly cls: KeyClass;
			readonly paths: readonly string[];
	  };

export interface ModelJsonCells {
	readonly table: string;
	readonly columns: Readonly<Record<string, JsonCell>>;
}

/**
 * The text leaves of an audit entry's `changes` (PR 8.3), per writer:
 * - the CREATED and DELETED snapshot of a shared expense (`serializeTransaction`):
 *   `description`, `notes`, each split's `rejectionReason`;
 * - the EDITED diff of an expense or a project (`{ old, new }` per field):
 *   `description`, `notes`, project `name`;
 * - a project's CREATED and DELETED `name`;
 * - a dispute's `reason` (answer-share.ts) and a billing period relabel.
 * Everything else in `changes` is an id, a code or an amount that SQL reads
 * (the payment guards, the path filters), so the entry cannot be sealed whole.
 * `previous` of a payment confirm keeps the source cells' own ciphertext and
 * is opened by openAuditChanges (confirm-restore.ts), not from here.
 */
const AUDIT_CHANGES_LEAVES = [
	"description",
	"description.old",
	"description.new",
	"notes",
	"notes.old",
	"notes.new",
	"name",
	"name.old",
	"name.new",
	"reason",
	"previousLabel",
	"newLabel",
	"splitParticipants.*.rejectionReason",
	// A link the user types (shared-transaction.ts accepts any URL), copied
	// into create and delete snapshots and the edit diff.
	"receiptUrl",
	"receiptUrl.old",
	"receiptUrl.new",
] as const;

export const JSON_CELLS = {
	AuditLogEntry: {
		table: "audit_log_entry",
		columns: {
			changes: {
				mode: "leaves",
				cls: "instance",
				paths: AUDIT_CHANGES_LEAVES,
			},
		},
	},
	IdempotencyKey: {
		table: "idempotency_key",
		columns: { responseBody: { mode: "body", cls: "user" } },
	},
	// The parsed rows and the parser's warnings of an import job (PR 8.2).
	// The file name, `fileData`, `errorMessage` and `statusMessage` are not
	// sealed by this: until the Revision 3 PR seals the last two, the first
	// warnings are still copied into `errorMessage` (import-queue.service.ts),
	// so sealing these two columns alone does not make import text private.
	ImportJob: {
		table: "import_job",
		columns: {
			transactions: { mode: "body", cls: "user" },
			warnings: { mode: "body", cls: "user" },
		},
	},
	// Copies of error report text; the admin reads them like the message.
	Feedback: {
		table: "feedback",
		columns: { diagnostics: { mode: "body", cls: "instance" } },
	},
} as const satisfies Record<string, ModelJsonCells>;

export type JsonModel = keyof typeof JSON_CELLS;

const JSON_MODELS: Readonly<Record<string, ModelJsonCells | undefined>> =
	JSON_CELLS;

/** The JSON cells of a Prisma model, or undefined when it has none. */
export function jsonCellsOfModel(model: string): ModelJsonCells | undefined {
	return Object.hasOwn(JSON_MODELS, model) ? JSON_MODELS[model] : undefined;
}

const buildCellClasses = (): ReadonlyMap<
	string,
	Readonly<Record<string, KeyClass>>
> =>
	new Map(
		[
			...new Set([...Object.keys(index.models), ...Object.keys(JSON_MODELS)]),
		].map((model) => [
			model,
			{
				...fieldsOfModel(model)?.columns,
				...Object.fromEntries(
					Object.entries(jsonCellsOfModel(model)?.columns ?? {}).map(
						([column, cell]) => [column, cell.cls],
					),
				),
			},
		]),
	);

let cellClasses = buildCellClasses();

/** Every sealed field of a model, text and JSON, to its key class. */
export function cellClassesOfModel(
	model: string,
): Readonly<Record<string, KeyClass>> {
	return cellClasses.get(model) ?? {};
}

/** Every JSON cell as `[table, column, cell]`, in map order. */
export function jsonColumns(): ReadonlyArray<
	readonly [table: string, column: string, cell: JsonCell]
> {
	return Object.values(JSON_MODELS).flatMap((model) =>
		model
			? Object.entries(model.columns).map(
					([column, cell]) => [model.table, column, cell] as const,
				)
			: [],
	);
}
