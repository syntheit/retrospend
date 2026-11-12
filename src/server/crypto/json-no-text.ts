/**
 * What stays plaintext in JSON (E2EE D11 PR 8.3, docs/roadmap/e2ee-d11-pr7-8.md,
 * "Audit leaves and the guard"). Two lists, both with reasons, so that a new
 * JSON column or a new text leaf cannot slip in unsealed:
 * - `NO_TEXT_JSON`: every `Json` column that is not in JSON_CELLS, and why it
 *   holds no user text (json-columns.test.ts fails on a column in neither);
 * - `AUDIT_NO_TEXT_KEYS`: the keys of an audit entry's `changes` whose string
 *   leaves are ids, codes, dates, numbers as text or server-made sentences.
 *   The sealed sweep (src/test/sealed-sweep.ts) flags every other string leaf
 *   that is not a declared leaf, so a writer that adds a text field to
 *   `changes` fails the sealed suite until the field is declared in
 *   fields.ts (or listed here with its reason).
 */
import { fieldsOfModel, type JsonCell } from "./fields";
import { leafPathMatches } from "./json-cells";

/** `Model.field` of a Json column that holds no user text, to the reason. */
export const NO_TEXT_JSON: Readonly<Record<string, string>> = {
	"ApiEvent.payload":
		"EventData is ids and Money by construction (events/data.ts)",
	"PushDelivery.payload": "ids and Money, built from EventData",
	"AuditLogEntry.context": "an action code and tags (payments/write.ts)",
	"BudgetBook.styleUndo": "ids, amounts and flags (E2EE rule 10)",
	"Envelope.limitUndo": "ids, amounts and flags (E2EE rule 10)",
	"EnvelopeChange.before":
		"ids, amounts and flags; the one name has its own column, previousName",
	"BudgetDraft.expectedIn": "ids and amounts from a zod schema",
	"BudgetDraft.lines": "ids and amounts from a zod schema",
	"BudgetDraft.moves": "ids and amounts from a zod schema",
	"BudgetDraft.pretend": "ids and amounts from a zod schema",
	"MonthClose.checkpoint": "ids, amounts and flags",
	"MonthClose.recalc": "ids, amounts and flags",
	"MonthClose.summary": "ids, amounts and flags",
	"IncomeRuleRun.record": "ids, amounts and flags",
	"PayoffPlan.customOrder": "account ids in order",
	"PayoffPlan.undo": "ids and amounts",
	"EventLog.metadata":
		"usernames and ids, identifiers not user text (D10 section 11)",
	"ExportJob.params": "ids, dates, flags and currency codes",
	"UserPageSetting.settings": "ids, flags and sort keys",
	"User.defaultAccounts": "account ids by kind",
	"User.defaultRateTypes": "rate type codes by currency",
	"SystemStatus.value": "flags and timestamps of server jobs",
	"Notification.data":
		"ids and formatted amounts; PR 8.4 stores minor amounts and builds the text at read time",
};

/** A key of `changes` whose string leaves are not user text. */
interface NoTextKeys {
	readonly keys: ReadonlySet<string>;
	readonly suffixes: readonly string[];
	readonly reason: string;
}

const noText = (
	reason: string,
	keys: readonly string[],
	suffixes: readonly string[] = [],
): NoTextKeys => ({ reason, keys: new Set(keys), suffixes });

export const AUDIT_NO_TEXT_KEYS: readonly NoTextKeys[] = [
	noText(
		"ids and participant types",
		["id", "counterparty", "participantRef", "previousOwner", "newOwner"],
		["Id", "Ids", "Type"],
	),
	noText("enum codes", [
		"splitMode",
		"status",
		"previousStatus",
		"newStatus",
		"role",
		"oldRole",
		"newRole",
		"verificationStatus",
		"categorySource",
		"restoredStatus",
		"answerTakenBack",
		"autoConfirmedField",
		"autoConfirmedReason",
		"visibility",
		"billingCycleLength",
		"billingClosePermission",
		"roleGranted",
		"undoOf",
	]),
	noText("currency codes", ["currency"], ["Currency"]),
	noText("dates, and decimals written as text", [
		"date",
		"createdAt",
		"updatedAt",
		"verifiedAt",
		"initiatedAt",
		"joinedOn",
		"leftOn",
		"amount",
		"exchangeRate",
		"budgetAmount",
		"confirmedAmount",
		"shareAmount",
		"sharePercentage",
	]),
	noText("a server-made file name or storage path", [
		"imagePath",
		"receiptUrl",
	]),
	noText(
		"a fixed English sentence the server writes (user-deletion.service.ts, members.service.ts)",
		["message"],
	),
];

/** The reason a key of `changes` is not user text, or undefined when it is not listed. */
export function noTextReason(key: string): string | undefined {
	for (const entry of AUDIT_NO_TEXT_KEYS)
		if (entry.keys.has(key) || entry.suffixes.some((s) => key.endsWith(s)))
			return entry.reason;
	return undefined;
}

/**
 * A key a field is stored under: the last name in the path that is not an
 * array index or the `old` and `new` of a diff (`projectId.old` is a
 * `projectId`).
 */
function fieldKey(path: readonly string[]): string {
	for (let i = path.length - 1; i >= 0; i--) {
		const part = path[i] as string;
		if (part !== "old" && part !== "new" && !/^\d+$/.test(part)) return part;
	}
	return "";
}

/**
 * Cells of a payment confirm's `previous` that were sealed where they lived
 * and are kept as that ciphertext (confirm-restore.ts): opened by
 * openAuditChanges with their source AAD, never from the extension.
 */
const SOURCE_SEALED: readonly string[] = [
	"previous.paymentMethod",
	...Object.keys(fieldsOfModel("Settlement")?.columns ?? {}).map(
		(column) => `previous.rows.*.${column}`,
	),
];

export type LeafClass =
	/** A text leaf the extension seals in place. */
	| "declared"
	/** A text leaf kept as its source cell's ciphertext. */
	| "source_sealed"
	| "no_text"
	/** Neither: a writer added a field nobody classified. */
	| "undeclared";

/** How a string leaf at `path` of an audit entry's `changes` is classified. */
export function classifyAuditLeaf(
	path: readonly string[],
	cell: Extract<JsonCell, { mode: "leaves" }>,
): LeafClass {
	if (cell.paths.some((p) => leafPathMatches(p, path))) return "declared";
	if (SOURCE_SEALED.some((p) => leafPathMatches(p, path)))
		return "source_sealed";
	// Everything else under `previous` is the settlement rows as they were:
	// ids, dates, codes and amounts. Their text columns are listed above.
	if (path[0] === "previous") return "no_text";
	return noTextReason(fieldKey(path)) ? "no_text" : "undeclared";
}
