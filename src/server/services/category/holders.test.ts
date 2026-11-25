/**
 * Catches: a column that holds a category id with no rule for it in a merge or
 * delete. The list is built again from the schema, never from the domain
 * list under test (AGENTS 6.8): every foreign key to Category must be a
 * holder, every Json column must be a holder, left as written with a reason,
 * or named here as holding no category id. A new column fails here until a
 * person decides what a merge does with it.
 */
import {
	CATEGORY_HOLDERS,
	CATEGORY_LEFT_ALONE,
	CATEGORY_LOOSE_HOLDERS,
	HOLDER_IDS,
} from "@retrospend/domain/category-merge/holders";
import { describe, expect, it } from "vitest";
import { readSchema } from "../../../test/prisma-schema";
import { HOLDERS, MOVE_ORDER } from "./holders";

const schema = readSchema();

/** Every `Model.column` that is a foreign key to Category, read from the schema. */
const foreignKeys = schema.flatMap((model) =>
	model.fields
		.filter((f) => f.type === "Category" && !f.list)
		.flatMap((f) => {
			const cols = /fields:\s*\[([^\]]+)\]/.exec(f.attributes)?.[1];
			return (cols ?? "").split(",").map((c) => `${model.name}.${c.trim()}`);
		}),
);

const jsonColumns = schema.flatMap((model) =>
	model.fields
		.filter((f) => f.type === "Json")
		.map((f) => `${model.name}.${f.name}`),
);

/** Json columns that hold no category id, each checked by reading its writers. */
const NO_CATEGORY_IDS: Readonly<Record<string, string>> = {
	"AuditLogEntry.changes": "audit history of what changed, ids as they were",
	"ApiEvent.payload": "ids and Money of an event that already happened",
	"PushDelivery.payload": "built from an event",
	"AuditLogEntry.context": "an action code and tags",
	"BudgetBook.styleUndo": "envelope ids and amounts",
	"Envelope.limitUndo": "envelope ids and amounts",
	"BudgetDraft.lines": "envelope ids and amounts",
	"BudgetDraft.moves": "envelope ids and amounts",
	"MonthClose.checkpoint": "envelope ids and amounts",
	"MonthClose.recalc": "envelope ids and amounts",
	"IncomeRuleRun.record": "rule ids and amounts, no match",
	"PayoffPlan.customOrder": "account ids",
	"PayoffPlan.undo": "account ids and amounts",
	"EventLog.metadata": "usernames and ids of sign-in events",
	"ExportJob.params": "dates, flags and currency codes",
	"UserPageSetting.settings": "ids of order, flags and sort keys, no category",
	"User.defaultAccounts": "account ids",
	"User.defaultRateTypes": "rate types by currency",
	"SystemStatus.value": "flags and timestamps",
	"Notification.data": "ids and formatted amounts of the event",
	"IdempotencyKey.responseBody":
		"a replayed answer or an undo stash; a category stash is taken by its own undo",
	"ImportJob.warnings": "the parser's warnings, text",
	"Feedback.diagnostics": "error report text",
};

describe("every holder of a category id has a rule", () => {
	it("a foreign key to Category is a listed holder, and the list names no foreign key that is gone", () => {
		expect(foreignKeys.length).toBeGreaterThan(0);
		const listed = CATEGORY_HOLDERS.map((h) => `${h.model}.${h.field}`);
		expect(listed.sort()).toEqual([...foreignKeys].sort());
	});

	it("a Json column is a holder, left as written with a reason, or holds no category id", () => {
		const placed = new Set([
			...CATEGORY_LOOSE_HOLDERS.map((h) => `${h.model}.${h.field}`),
			...CATEGORY_LEFT_ALONE.map((h) => `${h.model}.${h.field}`),
			...Object.keys(NO_CATEGORY_IDS),
		]);
		const unplaced = jsonColumns.filter((c) => !placed.has(c));
		expect(unplaced).toEqual([]);
	});

	it("every named column exists in the schema", () => {
		const real = new Set(
			schema.flatMap((m) => m.fields.map((f) => `${m.name}.${f.name}`)),
		);
		const named = [...CATEGORY_LOOSE_HOLDERS, ...CATEGORY_LEFT_ALONE].map(
			(h) => `${h.model}.${h.field}`,
		);
		expect(named.filter((c) => !real.has(c))).toEqual([]);
		const jsonNamed = Object.keys(NO_CATEGORY_IDS);
		expect(jsonNamed.filter((c) => !jsonColumns.includes(c))).toEqual([]);
	});

	it("the server has an adapter for every holder, and the move walks them all", () => {
		expect(Object.keys(HOLDERS).sort()).toEqual([...HOLDER_IDS].sort());
		expect([...MOVE_ORDER].sort()).toEqual([...HOLDER_IDS].sort());
		for (const id of HOLDER_IDS) {
			expect(typeof HOLDERS[id].move).toBe("function");
			expect(typeof HOLDERS[id].restore).toBe("function");
		}
	});
});
