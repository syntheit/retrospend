// Catches: the device engine's list of expense text columns (withoutText)
// drifting from the server's user-text field map. The engine cannot import
// src/server, so this is the one place the two lists meet: a column added to
// FIELD_MAP.Expense without the engine list (text a device would then keep in
// its outbox) fails here, and so does an engine column the map does not know.
// The same holds for a recurring template and the category joined onto it.
import {
	EXPENSE_TEXT_COLUMNS,
	TEMPLATE_JOINED_COLUMNS,
	TEMPLATE_STRIPPED_COLUMNS,
	TEMPLATE_TEXT_COLUMNS,
	templateWithoutText,
	withoutText,
} from "@retrospend/engine";
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

describe("the device's template text columns", () => {
	it("TEMPLATE_TEXT_COLUMNS equals FIELD_MAP.RecurringTemplate", () => {
		expect([...TEMPLATE_TEXT_COLUMNS].sort()).toEqual(
			Object.keys(FIELD_MAP.RecurringTemplate.columns).sort(),
		);
	});

	it("templateWithoutText drops every column the field map names, and the category's text", () => {
		// Built from the maps, not from the engine lists, so a column missing from
		// them survives templateWithoutText and fails this too.
		const text = Object.fromEntries(
			Object.keys(FIELD_MAP.RecurringTemplate.columns).map((c) => [
				c,
				`secret ${c}`,
			]),
		);
		const category = {
			id: "c1",
			color: "teal",
			icon: null,
			...Object.fromEntries(
				Object.keys(FIELD_MAP.Category.columns).map((c) => [
					c,
					`secret category ${c}`,
				]),
			),
		};
		const row = {
			...fixtureRow("recurringTemplates", "t1"),
			...text,
			category,
		};
		const bare = templateWithoutText(row as never) as Record<string, unknown>;
		for (const column of Object.keys(FIELD_MAP.RecurringTemplate.columns))
			expect(bare, column).not.toHaveProperty(column);
		expect(JSON.stringify(bare)).not.toContain("secret");
		expect(bare.id).toBe("t1");
	});

	it("TEMPLATE_STRIPPED_COLUMNS is the field map's columns plus the joined category", () => {
		expect([...TEMPLATE_STRIPPED_COLUMNS].sort()).toEqual(
			[...Object.keys(FIELD_MAP.RecurringTemplate.columns), "category"].sort(),
		);
		expect([...TEMPLATE_JOINED_COLUMNS]).toEqual(["category"]);
	});
});
