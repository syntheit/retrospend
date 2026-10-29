import { groupByDay } from "./days";

describe("groupByDay", () => {
	it("makes one group per day in the order the rows came", () => {
		const rows = [
			{ id: "a", date: "2026-10-17" },
			{ id: "b", date: "2026-10-17" },
			{ id: "c", date: "2026-10-16" },
		];
		expect(
			groupByDay(rows).map((g) => [g.day, g.expenses.map((r) => r.id)]),
		).toEqual([
			["2026-10-17", ["a", "b"]],
			["2026-10-16", ["c"]],
		]);
	});
	it("has no groups for no rows", () => {
		expect(groupByDay([])).toEqual([]);
	});
});
