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

	it("names the account for an account write, whose answer is the account's version", () => {
		expect(
			ackedTableOf([
				{ table: "legs" },
				{ table: "snapshots" },
				{ table: "accounts" },
			]),
		).toBe("accounts");
	});

	it("names no account for a transfer: it moves accounts but versions none, and answers with none", () => {
		expect(
			ackedTableOf([
				{ table: "accounts" },
				{ table: "legs" },
				{ table: "transfers" },
				{ table: "expenses" },
			]),
		).toBe("expenses");
	});
});
