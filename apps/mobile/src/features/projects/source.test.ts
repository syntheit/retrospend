import {
	balanceSides,
	daysSince,
	groupProjects,
	justBack,
	matchesProject,
	type ProjectItem,
	summaryCache,
} from "./source";

const item = (
	id: string,
	name: string,
	status: "ACTIVE" | "ARCHIVED",
	year: number,
): ProjectItem => ({ id, name, status, year }) as ProjectItem;

describe("groupProjects", () => {
	const items = [
		item("a", "Patagonia", "ACTIVE", 2026),
		item("b", "Flat 2024", "ARCHIVED", 2024),
		item("c", "Brazil", "ARCHIVED", 2025),
		item("d", "Home", "ACTIVE", 2026),
		item("e", "Flat 2024 b", "ARCHIVED", 2024),
	];

	it("lists active first in the server's order, then years newest first", () => {
		expect(
			groupProjects(items).map((g) => [g.key, g.projects.map((p) => p.id)]),
		).toEqual([
			["active", ["a", "d"]],
			["2025", ["c"]],
			["2024", ["b", "e"]],
		]);
	});

	it("leaves out a group with nothing in it", () => {
		expect(groupProjects([item("b", "x", "ARCHIVED", 2024)])).toHaveLength(1);
		expect(groupProjects([])).toEqual([]);
	});
});

describe("matchesProject", () => {
	it("ignores case and accents", () => {
		const trip = item("a", "Cañón del Colca", "ACTIVE", 2026);
		expect(matchesProject(trip, "canon")).toBe(true);
		expect(matchesProject(trip, "COLCA")).toBe(true);
		expect(matchesProject(trip, "lima")).toBe(false);
		expect(matchesProject(trip, "")).toBe(true);
	});
});

describe("balanceSides", () => {
	it("never nets one currency against another", () => {
		expect(
			balanceSides([
				{ minor: 12000, currency: "BRL" },
				{ minor: -450000, currency: "ARS" },
				{ minor: 0, currency: "USD" },
			]),
		).toEqual({
			owedToYou: [{ minor: 12000, currency: "BRL" }],
			youOwe: [{ minor: 450000, currency: "ARS" }],
		});
	});
});

describe("summaryCache", () => {
	it("keeps the whole project and a period apart", () => {
		expect(summaryCache("p1", null).name).not.toBe(
			summaryCache("p1", "x").name,
		);
	});
});

describe("justBack", () => {
	const trip = (
		id: string,
		last: string | null,
		over: Partial<ProjectItem> = {},
	) =>
		({
			id,
			status: "ACTIVE",
			solo: false,
			lastExpense: last,
			myBalance: [{ minor: 500, currency: "BRL" }],
			...over,
		}) as ProjectItem;

	it("takes the most recent active shared project that still has a balance", () => {
		const items = [
			trip("old", "2026-08-01"),
			trip("recent", "2026-10-18"),
			trip("newer", "2026-10-25"),
		];
		expect(justBack(items, "2026-10-29")?.id).toBe("newer");
	});

	it("skips solo, archived, settled and long-ago projects", () => {
		const items = [
			trip("solo", "2026-10-25", { solo: true }),
			trip("archived", "2026-10-25", { status: "ARCHIVED" }),
			trip("settled", "2026-10-25", { myBalance: [] }),
			trip("none", null),
			trip("ago", "2026-08-01"),
		];
		expect(justBack(items, "2026-10-29")).toBeNull();
	});

	it("counts whole days back", () => {
		expect(daysSince("2026-10-26", "2026-10-29")).toBe(3);
		expect(daysSince("2026-10-30", "2026-10-29")).toBe(0);
	});
});
