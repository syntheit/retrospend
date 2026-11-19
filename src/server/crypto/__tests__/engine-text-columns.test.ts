// Catches: the device engine's list of expense text columns (withoutText)
// drifting from the server's user-text field map. The engine cannot import
// src/server, so this is the one place the two lists meet: a column added to
// FIELD_MAP.Expense without the engine list (text a device would then keep in
// its outbox) fails here, and so does an engine column the map does not know.
import { EXPENSE_TEXT_COLUMNS, withoutText } from "@retrospend/engine";
import { fixtureRow } from "@retrospend/engine/fixtures";
import { describe, expect, it } from "vitest";
import { FIELD_MAP } from "../fields";

describe("the device's expense text columns", () => {
	it("EXPENSE_TEXT_COLUMNS equals FIELD_MAP.Expense", () => {
		expect([...EXPENSE_TEXT_COLUMNS].sort()).toEqual(
			Object.keys(FIELD_MAP.Expense.columns).sort(),
		);
	});

	it("withoutText drops every column the field map names", () => {
		// Built from the map, not from the engine list, so a column missing from
		// the engine list survives withoutText and fails this too.
		const text = Object.fromEntries(
			Object.keys(FIELD_MAP.Expense.columns).map((c) => [c, `secret ${c}`]),
		);
		const row = { ...fixtureRow("expenses", "e1"), ...text };
		const bare = withoutText(row) as Record<string, unknown>;
		for (const column of Object.keys(FIELD_MAP.Expense.columns))
			expect(bare, column).not.toHaveProperty(column);
		expect(bare.id).toBe("e1");
		expect(JSON.stringify(bare)).not.toContain("secret");
	});
});
