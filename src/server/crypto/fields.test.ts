// Catches: the user-text field map (fields.ts) drifting from the things that
// must agree with it (E2EE lane D11, design section 1.1 and Revision 1 item
// 10): the control-character scan list, the fields the contract declares, and
// the Prisma schema. A new text column, a renamed table or a new composite key
// fails here until the map says what to do with it.
//
// The schema is read from prisma/schema.prisma (src/test/prisma-schema.ts).
import { readFileSync } from "node:fs";
import { USER_TEXT_FIELDS } from "@retrospend/api-contract";
import { describe, expect, it } from "vitest";
import { USER_TEXT_COLUMNS } from "../../../scripts/scan-control-chars";
import { readSchema } from "../../test/prisma-schema";
import { scanSources } from "../../test/source-scan";
import {
	FIELD_MAP,
	fieldsOfModel,
	type KeyClass,
	keyClassOfColumn,
	keyClassOfField,
	mappedColumns,
	modelOfTable,
} from "./fields";

const schema = readSchema();
const modelByName = new Map(schema.map((m) => [m.name, m]));

describe("the schema reader", () => {
	it("finds the models, their tables and their ids", () => {
		expect(schema.length).toBeGreaterThan(60);
		expect(modelByName.get("Expense")?.table).toBe("expense");
		expect(modelByName.get("Expense")?.idFields).toEqual(["id"]);
		// A composite key is read as its parts, so the single-id test would catch it.
		expect(
			schema.some((m) => m.idFields.length > 1),
			"a model with @@id",
		).toBe(true);
	});
});

describe("the field map and the scan list", () => {
	it("hold the same (table, column) set", () => {
		const scan = USER_TEXT_COLUMNS.map(([t, c]) => `${t}.${c}`).sort();
		const mapped = mappedColumns()
			.map(([t, c]) => `${t}.${c}`)
			.sort();
		expect(mapped).toEqual(scan);
	});
});

/**
 * Declared contract fields to the cells that store them. A contract name is
 * not a model name (design section 1.1), so this is written by hand.
 */
const STORED: Record<string, string[]> = {
	"account.name": ["asset_account.name"],
	"apikey.name": ["apikey.name"],
	"billing_period.label": ["billing_period.label"],
	"budgetGroup.name": ["envelope_group.name"],
	"category.name": ["category.name"],
	"envelope.name": ["envelope.name"],
	"expense.description": ["expense.description"],
	"expense.location": ["expense.location"],
	"expense.title": ["expense.title"],
	"feedback.adminNote": ["feedback.adminNote"],
	"feedback.message": ["feedback.message"],
	"fixRequest.message": ["fix_request.message"],
	"fixRequest.reply": ["fix_request.reply"],
	"guest_session.name": ["guest_session.name"],
	// Money in is an expense row with an income direction.
	"import_job.fileName": ["import_job.fileName"],
	"income.description": ["expense.description"],
	"income.title": ["expense.title"],
	"incomeRule.matchTitle": ["income_rule.matchTitle"],
	"incomeRule.name": ["income_rule.name"],
	"payment.method": ["payment.paymentMethod", "settlement.paymentMethod"],
	"payment.note": ["payment.note", "settlement.note"],
	"payment.reject_reason": ["settlement.rejectedReason"],
	"payment_method.identifier": ["payment_method.identifier"],
	"payment_method.label": ["payment_method.label"],
	"person.name": ["shadow_profile.name"],
	"push_device.deviceName": ["push_device.deviceName"],
	"project.description": ["project.description"],
	"project.name": ["project.name"],
	"recurring.name": ["recurring_template.name"],
	"recurring.paymentSource": ["recurring_template.paymentSource"],
	"recurring.websiteUrl": ["recurring_template.websiteUrl"],
	"shared_expense.description": ["shared_transaction.description"],
	"shared_expense.notes": ["shared_transaction.notes"],
	"shared_expense.receiptUrl": ["shared_transaction.receiptUrl"],
	"shared_expense.reject_reason": ["split_participant.rejectionReason"],
	"transfer.note": ["transfer.note"],
	"user.name": ["user.name"],
	"webhook.name": ["webhook.name"],
};

/** Declared fields that no column stores of their own (design section 1.1). */
const NOT_STORED: Record<string, string> = {
	"expense.search": "a search filter, never written",
	"sharedExpense.correctionTitle":
		"the title of a correction, which is stored as shared_transaction.description",
};

/** Mapped cells that no declared field writes today, with why that is fine. */
const NO_DECLARED_FIELD: Record<string, string> = {
	"budget_book.name":
		"no input names a book: createBook leaves it to the column default",
	"budget_movement.note":
		"no write path sets a note today; one that does must declare its field",
	"wealth_transfer.note":
		"no write path sets a note today; one that does must declare its field",
	"envelope_change.previousName":
		"a server copy of envelope.name taken before a rename; no input names it",
	"export_job.fileName":
		"derived by the server from a project or person name; no input names it",
};

/**
 * Every field declared through `userText("field", max)` or
 * `userTextOrEmpty(...)` in the source, found by reading the files, plus the
 * registry the loaded contract filled. The registry alone would miss a field a
 * router declares, because only the modules a test imports register.
 */
function declaredFields(): string[] {
	const fields = new Set(USER_TEXT_FIELDS);
	const files = scanSources({
		roots: ["src", "packages"],
		include: /\.tsx?$/,
		exclude: /\.test\.tsx?$|common[\\/]user-text\.ts$/,
	});
	for (const file of files)
		for (const m of readFileSync(file, "utf8").matchAll(
			/\buserText(?:OrEmpty)?\(\s*"([^"]+)"/g,
		))
			fields.add(m[1] ?? "");
	return [...fields].filter((f) => !f.startsWith("test.")).sort();
}

describe("the field map and the declared fields", () => {
	const declared = declaredFields();

	it("sees the declared fields", () => {
		expect(declared.length).toBeGreaterThan(35);
	});

	it("maps every declared field to a column, or names it as not stored", () => {
		expect(
			declared.filter((f) => !(f in STORED) && !(f in NOT_STORED)),
		).toEqual([]);
	});

	it("keeps no stale entry in the field list", () => {
		const known = new Set(declared);
		expect(
			[...Object.keys(STORED), ...Object.keys(NOT_STORED)].filter(
				(f) => !known.has(f),
			),
		).toEqual([]);
	});

	it("points every declared field at a mapped column", () => {
		const mapped = new Set(mappedColumns().map(([t, c]) => `${t}.${c}`));
		const missing = Object.entries(STORED).flatMap(([field, cells]) =>
			cells.filter((cell) => !mapped.has(cell)).map((c) => `${field} -> ${c}`),
		);
		expect(missing).toEqual([]);
	});

	it("leaves a mapped column without a declared field only when explained", () => {
		const hit = new Set(Object.values(STORED).flat());
		const unwritten = mappedColumns()
			.map(([t, c]) => `${t}.${c}`)
			.filter((cell) => !hit.has(cell))
			.sort();
		expect(unwritten).toEqual(Object.keys(NO_DECLARED_FIELD).sort());
	});

	it("writes a reason for every list entry", () => {
		for (const [name, why] of [
			...Object.entries(NOT_STORED),
			...Object.entries(NO_DECLARED_FIELD),
		])
			expect(why.length, name).toBeGreaterThan(10);
	});
});

describe("the field map and the Prisma schema", () => {
	it("names real models, with the right table", () => {
		for (const [model, { table }] of Object.entries(FIELD_MAP)) {
			expect(modelByName.has(model), model).toBe(true);
			expect(modelByName.get(model)?.table, model).toBe(table);
		}
	});

	it("maps String columns of the model, one to a field", () => {
		for (const [model, { columns }] of Object.entries(FIELD_MAP))
			for (const column of Object.keys(columns)) {
				const field = modelByName
					.get(model)
					?.fields.find((f) => f.name === column);
				expect(field?.type, `${model}.${column}`).toBe("String");
				expect(field?.list, `${model}.${column}`).toBe(false);
			}
	});

	it("gives every mapped model a single string @id", () => {
		for (const model of Object.keys(FIELD_MAP)) {
			const entry = modelByName.get(model);
			expect(entry?.idFields, `${model} id`).toHaveLength(1);
			const id = entry?.fields.find((f) => f.name === entry.idFields[0]);
			expect(id?.type, `${model} id type`).toBe("String");
			expect(id?.list, `${model} id list`).toBe(false);
		}
	});

	it("stores every mapped column as unbounded text, so a ciphertext fits", () => {
		// A sealed value is 4 * plaintext limit + 48 characters (user-text-capacity.pg.test.ts
		// holds the declared limits), so a VarChar(n) sized for plaintext fails the first write.
		const bounded = Object.entries(FIELD_MAP).flatMap(([model, { columns }]) =>
			Object.keys(columns)
				.filter((column) => {
					const field = modelByName
						.get(model)
						?.fields.find((f) => f.name === column);
					return /@db\.(VarChar|Char)/.test(field?.attributes ?? "");
				})
				.map((column) => `${model}.${column}`),
		);
		expect(bounded).toEqual([]);
	});

	it("uses no @map on a field, so a column is its Prisma field name", () => {
		const renamed = schema.flatMap((m) =>
			m.fields
				.filter((f) => /@map\(/.test(f.attributes))
				.map((f) => `${m.name}.${f.name}`),
		);
		expect(renamed).toEqual([]);
	});
});

/** The words that make a String column look like text a person typed. */
const TEXT_LOOKING =
	/name|title|descr|note|label|message|reply|reason|location|comment|memo|text|identifier|method|url|email|phone|detail|address|metadata|body|content|subject|summary|caption/i;

/**
 * String columns that look like free text and are left out of the map on
 * purpose, over every model in the schema. A new entry needs a reason a
 * reviewer accepts. Entries marked "owner call" are open decisions.
 */
const NOT_SEALED: Record<string, string> = {
	"user.username": "sign-in handle, unique and looked up as it is typed",
	"user.email": "sign-in identity, written on the owner connection only",
	"user.pendingEmail": "sign-in identity, written on the owner connection only",
	"user.pendingEmailToken": "a one-time token, not text",
	"username_history.previousUsername": "a sign-in handle, like user.username",
	"verification.identifier": "an email or token key of a sign-in flow",
	"verification_token.identifier": "an email or token key of a sign-in flow",
	"password_reset_token.identifier": "an email or token key of a sign-in flow",
	"session.ipAddress": "a network address, not typed text",
	"event_log.ipAddress": "a network address, not typed text",
	"category.nameIndex": "the D9 blind index of the name, an HMAC, not text",
	"push_device.addressHash": "a hash of the device address, not text",
	"shadow_profile.email":
		"owner call: a contact address, outside the user-text list",
	"shadow_profile.phone":
		"owner call: a contact number, outside the user-text list",
	"guest_session.email":
		"owner call: a contact address, outside the user-text list",
	"settlement.autoConfirmedReason": "a system code set by the server",
	"feedback.pageUrl": "the app route the feedback was sent from",
	"webhook.url":
		"owner call: a delivery address, which can carry a secret in its path",
	"webhook.disabledReason": "a system code from a fixed list",
	"apikey.metadata": "a JSON string the key plugin writes, not typed text",
	"notification.title":
		"built from ids at read time or sealed with the JSON copies (D11 PR 8, Revision 1 item 8)",
	"notification.body":
		"built from ids at read time or sealed with the JSON copies (D11 PR 8, Revision 1 item 8)",
	"error_report.message":
		"owner call: app crash text, scrubbed by the app and the server, not typed",
	"error_report.stack":
		"owner call: app crash stack, scrubbed by the app and the server, not typed",
	"import_job.fileData":
		"owner call: the uploaded file as base64, cleared after processing, so it holds row text for a short time",
	"import_job.errorMessage":
		"owner call: server and sidecar progress text, which may quote a row",
	"import_job.statusMessage":
		"owner call: server and sidecar progress text, which may quote a row",
	"export_job.contentType": "a MIME type, not text",
};

describe("free-text-looking columns anywhere in the schema", () => {
	const found = schema.flatMap((model) =>
		model.fields
			.filter((f) => f.type === "String" && !f.list)
			.filter(
				(f) => !Object.hasOwn(fieldsOfModel(model.name)?.columns ?? {}, f.name),
			)
			.filter(
				(f) =>
					!model.idFields.includes(f.name) &&
					(/@db\.Text/.test(f.attributes) || TEXT_LOOKING.test(f.name)),
			)
			.map((f) => `${model.table}.${f.name}`),
	);

	it("scans the whole schema, not only mapped tables", () => {
		expect(found).toContain("notification.title");
		expect(found).toContain("error_report.message");
	});

	it("are mapped, or explained", () => {
		expect(found.filter((cell) => !(cell in NOT_SEALED))).toEqual([]);
	});

	it("keep no explanation for a column that is gone or now mapped", () => {
		expect(Object.keys(NOT_SEALED).filter((c) => !found.includes(c))).toEqual(
			[],
		);
	});

	it("writes a reason for every entry", () => {
		for (const [cell, why] of Object.entries(NOT_SEALED))
			expect(why.length, cell).toBeGreaterThan(10);
	});
});

describe("key classes", () => {
	// Revision 2 of docs/roadmap/e2ee-d11-design.md, final for PR 1, plus the
	// review additions: envelope_change.previousName (a copy of envelope.name,
	// instance) and export_job.fileName, import_job.fileName and
	// push_device.deviceName (personal text, user). income_rule and
	// wealth_transfer moved to instance (docs/roadmap/e2ee-d11-pr3.md 2.1):
	// every book member reads them, and income_rule has no owner column.
	const USER: string[] = [
		"expense.title",
		"expense.description",
		"expense.location",
		"category.name",
		"asset_account.name",
		"transfer.note",
		"recurring_template.name",
		"recurring_template.paymentSource",
		"recurring_template.websiteUrl",
		"export_job.fileName",
		"import_job.fileName",
		"push_device.deviceName",
	];
	const INSTANCE: string[] = [
		"shared_transaction.description",
		"shared_transaction.notes",
		"shared_transaction.receiptUrl",
		"split_participant.rejectionReason",
		"settlement.note",
		"settlement.paymentMethod",
		"settlement.rejectedReason",
		"payment.note",
		"payment.paymentMethod",
		"fix_request.message",
		"fix_request.reply",
		"project.name",
		"project.description",
		"billing_period.label",
		"payment_method.label",
		"payment_method.identifier",
		"shadow_profile.name",
		"guest_session.name",
		"user.name",
		"budget_book.name",
		"envelope.name",
		"envelope_group.name",
		"budget_movement.note",
		"feedback.message",
		"feedback.adminNote",
		"apikey.name",
		"webhook.name",
		"envelope_change.previousName",
		"income_rule.name",
		"income_rule.matchTitle",
		"wealth_transfer.note",
	];

	const classOf = (keyClass: KeyClass) =>
		mappedColumns()
			.filter(([, , c]) => c === keyClass)
			.map(([t, col]) => `${t}.${col}`)
			.sort();

	it("seals the owner's personal text with the user key", () => {
		expect(classOf("user")).toEqual([...USER].sort());
	});

	it("seals text other people read with the instance key", () => {
		expect(classOf("instance")).toEqual([...INSTANCE].sort());
	});

	it("gives every model with a user-class cell a userId column, its owner", () => {
		// A user-class cell opens with the row owner's key (field-open.ts reads
		// `userId`), so there is no ownerless user-class cell.
		for (const [model, { columns }] of Object.entries(FIELD_MAP)) {
			if (!Object.values(columns).includes("user")) continue;
			const owner = modelByName
				.get(model)
				?.fields.find((f) => f.name === "userId");
			expect(owner?.type, `${model}.userId`).toBe("String");
			expect(owner?.list, `${model}.userId`).toBe(false);
		}
	});

	it("gives every cell exactly one class", () => {
		const cells = mappedColumns().map(([t, c]) => `${t}.${c}`);
		expect(new Set(cells).size).toBe(cells.length);
		expect(cells.length).toBe(USER.length + INSTANCE.length);
	});
});

describe("lookups", () => {
	it("find a model's entry by Prisma name", () => {
		expect(fieldsOfModel("Expense")?.table).toBe("expense");
		expect(fieldsOfModel("Budget")).toBeUndefined();
		expect(fieldsOfModel("toString")).toBeUndefined();
	});

	it("find the model of a table", () => {
		expect(modelOfTable("shared_transaction")).toBe("SharedTransaction");
		expect(modelOfTable("expense_rate")).toBeUndefined();
	});

	it("find a key class by model and field, and by table and column", () => {
		expect(keyClassOfField("Expense", "title")).toBe("user");
		expect(keyClassOfColumn("expense", "title")).toBe("user");
		expect(keyClassOfField("SharedTransaction", "notes")).toBe("instance");
		expect(keyClassOfColumn("shared_transaction", "notes")).toBe("instance");
		expect(keyClassOfColumn("user", "name")).toBe("instance");
	});

	it("find nothing for a column that holds no user text", () => {
		expect(keyClassOfField("Expense", "currency")).toBeUndefined();
		expect(keyClassOfColumn("expense", "currency")).toBeUndefined();
		expect(keyClassOfColumn("expense", "toString")).toBeUndefined();
		expect(keyClassOfColumn("no_such_table", "name")).toBeUndefined();
	});

	it("list every cell with its class", () => {
		expect(mappedColumns()).toContainEqual(["category", "name", "user"]);
		expect(mappedColumns()).toContainEqual(["webhook", "name", "instance"]);
	});
});
