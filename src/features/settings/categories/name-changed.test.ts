import { describe, expect, it } from "vitest";
import { nameChanged } from "./name-changed";

describe("nameChanged", () => {
	it("is false for the stored name, so the save sends no name", () => {
		expect(nameChanged("Groceries", "Groceries")).toBe(false);
	});

	it("is true for a different name, a different case, or a trailing space", () => {
		expect(nameChanged("Groceries", "Food")).toBe(true);
		expect(nameChanged("Groceries", "groceries")).toBe(true);
		expect(nameChanged("Groceries ", "Groceries")).toBe(true);
	});

	it("is true when the category is not in the list yet", () => {
		expect(nameChanged(undefined, "Groceries")).toBe(true);
	});
});
