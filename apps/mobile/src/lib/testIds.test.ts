import { rowId, TEST_IDS } from "./testIds";

// Maestro flows find controls by these ids; the convention keeps them stable
// and readable ("<screen>.<element>", rows "<screen>.row.<entityId>").
describe("test ids", () => {
	const ids = Object.values(TEST_IDS).flatMap((group) => Object.values(group));

	it("follow <screen>.<element>", () => {
		for (const id of ids) {
			expect(id).toMatch(/^[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*$/);
		}
	});

	it("are unique", () => {
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("names a row by its screen and entity id", () => {
		expect(rowId("activity", "e_123")).toBe("activity.row.e_123");
	});
});
