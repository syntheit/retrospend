import { describe, expect, it } from "vitest";
import { jsonColumns } from "./fields";
import {
	plainBodySql,
	plainTextSql,
	stringLeaves,
	textLeaves,
} from "./plaintext-sql";

const leavesCell = (() => {
	const found = jsonColumns().find(([, , cell]) => cell.mode === "leaves");
	if (found?.[2].mode !== "leaves") throw new Error("no leaves cell");
	return found[2];
})();
const SEALED = "\u0001k1:AAAAAQ==";

describe("textLeaves", () => {
	it("walks objects and arrays with their paths", () => {
		expect([...stringLeaves({ a: ["x", { b: "y" }], n: 1 })]).toEqual([
			[["a", "0"], "x"],
			[["a", "1", "b"], "y"],
		]);
	});

	it("tells sealed, plaintext and undeclared leaves apart, and skips no-text ones", () => {
		const out = [
			...textLeaves(
				{
					name: "plain name",
					description: { old: SEALED, new: "plain" },
					notThere: "who knows",
					previous: { rows: [{ id: "r1" }] },
				},
				leavesCell,
			),
		].map(({ path, state }) => [path.join("."), state]);
		expect(out).toEqual([
			["name", "plaintext"],
			["description.old", "sealed"],
			["description.new", "plaintext"],
			["notThere", "undeclared"],
		]);
	});
});

describe("the SQL predicates", () => {
	it("check the wire prefix, and keep the budget book's default name", () => {
		expect(plainTextSql("expense", "title")).toContain("\\x01k1:");
		expect(plainTextSql("expense", "title")).not.toContain("Personal");
		expect(plainTextSql("budget_book", "name")).toContain("<> 'Personal'");
		expect(plainBodySql("responseBody")).toContain("->>'sealed'");
	});
});
