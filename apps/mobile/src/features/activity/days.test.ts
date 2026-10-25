import { dayBefore, groupByDay } from "./days";

const row = (id: string, date: string) => ({ id, date });

describe("dayBefore", () => {
	it("crosses month and year ends", () => {
		expect(dayBefore("2026-10-01")).toBe("2026-09-30");
		expect(dayBefore("2026-01-01")).toBe("2025-12-31");
		expect(dayBefore("2024-03-01")).toBe("2024-02-29");
	});
});

describe("groupByDay", () => {
	const totals = { "2026-10-24": { minor: 100, currency: "ARS" } };

	it("makes one section per run of equal dates, with the server's totals", () => {
		const sections = groupByDay(
			[
				row("a", "2026-10-25"),
				row("b", "2026-10-24"),
				row("c", "2026-10-24"),
				row("d", "2026-10-20"),
			],
			totals,
			"2026-10-25",
		);
		expect(sections.map((s) => [s.day, s.relative, s.items.length])).toEqual([
			["2026-10-25", "today", 1],
			["2026-10-24", "yesterday", 2],
			["2026-10-20", null, 1],
		]);
		expect(sections[1]?.total).toEqual({ minor: 100, currency: "ARS" });
		expect(sections[0]?.total).toBeNull();
	});

	it("takes no totals when the server sent none", () => {
		const sections = groupByDay([row("a", "2026-10-25")], null, "2026-10-25");
		expect(sections[0]?.total).toBeNull();
	});

	it("is empty for no rows", () => {
		expect(groupByDay([], null, "2026-10-25")).toEqual([]);
	});
});
