import { describe, expect, it } from "vitest";
import { ackedTableOf } from "./acked-table";

describe("ackedTableOf", () => {
	it("names the template when the write changed one, with or without an expense", () => {
		expect(ackedTableOf([{ table: "recurringTemplates" }])).toBe(
			"recurringTemplates",
		);
		expect(
			ackedTableOf([{ table: "expenses" }, { table: "recurringTemplates" }]),
		).toBe("recurringTemplates");
	});

	it("names the expense otherwise", () => {
		expect(ackedTableOf([{ table: "expenses" }])).toBe("expenses");
		expect(ackedTableOf([])).toBe("expenses");
	});
});
