import { describe, expect, it } from "vitest";
import { EXPENSE_TEXT_COLUMNS, withoutText } from "./expenses";
import { fixtureRow } from "./fixtures";

describe("withoutText", () => {
	const row = {
		...fixtureRow("expenses", "e1"),
		title: "Lunch",
		description: "with Ana",
		location: "Cafe",
		version: "2026-03-05T12:00:00.000Z",
	};

	it("drops exactly the text columns and keeps every other column", () => {
		const bare = withoutText(row);
		for (const c of EXPENSE_TEXT_COLUMNS) expect(bare).not.toHaveProperty(c);
		const { title, description, location, ...rest } = row;
		expect([title, description, location]).toEqual([
			"Lunch",
			"with Ana",
			"Cafe",
		]);
		expect(bare).toEqual(rest);
		expect(bare.version).toBe("2026-03-05T12:00:00.000Z");
	});

	it("does not change the row it is given", () => {
		withoutText(row);
		expect(row.title).toBe("Lunch");
	});

	it("keeps a null version null", () => {
		expect(withoutText({ ...row, version: null }).version).toBeNull();
	});
});
