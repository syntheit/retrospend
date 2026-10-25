import {
	balanceSides,
	groupProjects,
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
