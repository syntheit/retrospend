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
 * Key classes, final per the owner's answers (design doc, Revision 2):
 * - `user`: personal text, sealed with the row owner's data key.
 * - `instance`: text other people read (shared expenses, projects, shared
 *   budget books, co-participant names, admin views, better-auth reads), sealed
 *   with the instance key.
 *
 * Nothing seals through this map yet. `fields.test.ts` holds it in step with
 * the control-character scan list, the declared contract fields and the Prisma
 * schema, so a new text column fails a test until it is placed here.
 */

export type KeyClass = "user" | "instance";

export interface ModelFields {
	/** The SQL table name (the model's `@@map`). */
	readonly table: string;
	/** Column (and Prisma field) name to the key class that seals it. */
	readonly columns: Readonly<Record<string, KeyClass>>;
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
		columns: { name: "user", matchTitle: "user" },
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
	WealthTransfer: { table: "wealth_transfer", columns: { note: "user" } },
	Webhook: { table: "webhook", columns: { name: "instance" } },
} as const satisfies Record<string, ModelFields>;

/** A Prisma model name that has at least one mapped column. */
export type MappedModel = keyof typeof FIELD_MAP;

const MODELS: Readonly<Record<string, ModelFields | undefined>> = FIELD_MAP;

const MODEL_BY_TABLE: ReadonlyMap<string, MappedModel> = new Map(
	(Object.keys(FIELD_MAP) as MappedModel[]).map((model) => [
		FIELD_MAP[model].table,
		model,
	]),
);

/** The map entry for a Prisma model name, or undefined when it holds no user text. */
export function fieldsOfModel(model: string): ModelFields | undefined {
	return Object.hasOwn(MODELS, model) ? MODELS[model] : undefined;
}

/** The Prisma model that owns a SQL table, or undefined when it holds no user text. */
export function modelOfTable(table: string): MappedModel | undefined {
	return MODEL_BY_TABLE.get(table);
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
	const model = MODEL_BY_TABLE.get(table);
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
