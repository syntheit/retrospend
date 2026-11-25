import { describe, expect, it } from "vitest";
import { undoCreated } from "./undo-created";

function ops(counts: Record<string, number>) {
	const removed: string[] = [];
	return {
		removed,
		ops: {
			expenseCount: async (id: string) => counts[id] ?? 0,
			remove: async (id: string) => {
				removed.push(id);
			},
		},
	};
}

describe("undoCreated", () => {
	it("removes every empty category", async () => {
		const t = ops({});
		await undoCreated(["cafe", "gym"], t.ops);
		expect(t.removed).toEqual(["cafe", "gym"]);
	});

	it("removes none when a later one holds expenses, so the empty one is not lost", async () => {
		const t = ops({ gym: 2 });
		await expect(undoCreated(["cafe", "gym"], t.ops)).rejects.toThrow();
		expect(t.removed).toEqual([]);
	});
});
