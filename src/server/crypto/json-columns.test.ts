// Catches: a Json column added to the schema without saying whether it holds
// user text (E2EE D11 PR 8.3, docs/roadmap/e2ee-d11-pr7-8.md, "Audit leaves
// and the guard"), and an audit leaf or key classified two ways. Every Json
// field is either a JSON cell in JSON_CELLS (sealed) or in NO_TEXT_JSON with a
// reason; a new one fails here until it is placed.
//
// The schema is read from prisma/schema.prisma (src/test/prisma-schema.ts).
import { describe, expect, it } from "vitest";
import { readSchema } from "../../test/prisma-schema";
import { jsonCellsOfModel, JSON_CELLS } from "./fields";
import {
	AUDIT_NO_TEXT_KEYS,
	classifyAuditLeaf,
	NO_TEXT_JSON,
	noTextReason,
} from "./json-no-text";

const schema = readSchema();
const jsonFields = schema.flatMap((model) =>
	model.fields
		.filter((field) => field.type === "Json")
		.map((field) => ({ model: model.name, table: model.table, ...field })),
);
const named = (model: string, field: string) => `${model}.${field}`;

/**
 * Columns PR 8.2 maps (import rows, their warnings, feedback diagnostics).
 * Until it lands they may be in neither list; once mapped they must be in
 * JSON_CELLS. Remove this set when 8.2 is merged.
 */
const SEALED_BY_PR_8_2 = new Set([
	"ImportJob.transactions",
	"ImportJob.warnings",
	"Feedback.diagnostics",
]);

describe("every Json column", () => {
	it("is read from the schema (28 today)", () => {
		expect(jsonFields.length).toBe(28);
		expect(jsonFields.map((f) => named(f.model, f.name))).toContain(
			"AuditLogEntry.changes",
		);
	});

	it("is a JSON cell or says why it holds no user text, never both", () => {
		const unplaced: string[] = [];
		const both: string[] = [];
		for (const f of jsonFields) {
			const key = named(f.model, f.name);
			const mapped = Boolean(jsonCellsOfModel(f.model)?.columns[f.name]);
			const listed = Object.hasOwn(NO_TEXT_JSON, key);
			if (mapped && listed) both.push(key);
			if (!mapped && !listed && !SEALED_BY_PR_8_2.has(key)) unplaced.push(key);
		}
		expect(unplaced, "classify in JSON_CELLS or NO_TEXT_JSON").toEqual([]);
		expect(both).toEqual([]);
	});

	it("is named by NO_TEXT_JSON and JSON_CELLS only when it exists, with a reason", () => {
		const real = new Set(jsonFields.map((f) => named(f.model, f.name)));
		for (const [key, reason] of Object.entries(NO_TEXT_JSON)) {
			expect(real.has(key), `${key} is a Json column`).toBe(true);
			expect(reason.length, `${key} has a reason`).toBeGreaterThan(10);
		}
		for (const [model, cells] of Object.entries(JSON_CELLS)) {
			const table = schema.find((m) => m.name === model)?.table;
			expect(cells.table, `${model} table`).toBe(table);
			for (const column of Object.keys(cells.columns))
				expect(real.has(named(model, column)), `${model}.${column}`).toBe(true);
		}
	});
});

const cell = JSON_CELLS.AuditLogEntry.columns.changes;
const classify = (path: string) => classifyAuditLeaf(path.split("."), cell);

describe("the leaves of an audit entry's changes", () => {
	it("are declared per writer: expense and project text, a dispute reason, a relabel", () => {
		for (const path of [
			"description",
			"notes",
			"splitParticipants.0.rejectionReason",
			"splitParticipants.12.rejectionReason",
			"description.old",
			"notes.new",
			"name",
			"name.old",
			"reason",
			"previousLabel",
			"newLabel",
		])
			expect(classify(path), path).toBe("declared");
	});

	it("keep a confirm's source-sealed text apart from the extension's", () => {
		for (const path of [
			"previous.paymentMethod",
			"previous.rows.0.note",
			"previous.rows.3.paymentMethod",
			"previous.rows.1.rejectedReason",
		])
			expect(classify(path), path).toBe("source_sealed");
		expect(classify("previous.rows.0.currency")).toBe("no_text");
		expect(classify("previous.ledger")).toBe("no_text");
	});

	it("name ids, codes and dates as no text, at any depth of a diff", () => {
		for (const path of [
			"id",
			"currency",
			"date",
			"createdAt",
			"projectId.old",
			"projectId.new",
			"paidBy.old.participantId",
			"splitParticipants.old.0.participantType",
			"splitParticipants.2.verificationStatus",
			"settlementIds.1",
			"imagePath.new",
			"message",
			"amount",
			"budgetCurrency.new",
			"membership.old.joinedOn",
		])
			expect(classify(path), path).toBe("no_text");
	});

	it("flag a string nobody classified, and a declared name at the wrong place", () => {
		expect(classify("title")).toBe("undeclared");
		expect(classify("rebalanced.addedParticipant.displayName")).toBe(
			"undeclared",
		);
		expect(classify("location.new")).toBe("undeclared");
		// `reason` is declared at the top only; a deeper one is a new field.
		expect(classify("x.reason")).toBe("undeclared");
	});

	it("list no key twice, each with a reason", () => {
		const seen = new Set<string>();
		for (const entry of AUDIT_NO_TEXT_KEYS) {
			expect(entry.reason.length).toBeGreaterThan(5);
			for (const key of entry.keys) {
				expect(seen.has(key), key).toBe(false);
				seen.add(key);
			}
		}
		expect(noTextReason("participantId")).toBe("ids and participant types");
		expect(noTextReason("description")).toBeUndefined();
	});

	it("never declare a key that is also listed as no text", () => {
		for (const path of cell.paths)
			expect(noTextReason(path.split(".")[0] as string), path).toBeUndefined();
	});
});
