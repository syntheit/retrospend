import type { SearchResult } from "@retrospend/api-contract";
import {
	addRecent,
	groupsOf,
	matchPlaces,
	parseRecents,
	places,
	RECENT_MAX,
} from "./rules";

jest.mock("@/layout/destinations", () => ({
	PROJECTS_APART: false,
	CURRENCIES_APART: false,
	RECURRING_APART: false,
}));

describe("addRecent", () => {
	it("puts the newest first and drops a repeat in any case", () => {
		expect(addRecent(["coffee", "rent"], "  Rent ")).toEqual(["Rent", "coffee"]);
	});

	it("ignores an empty search and caps the list", () => {
		expect(addRecent(["a"], "   ")).toEqual(["a"]);
		const many = Array.from({ length: RECENT_MAX }, (_, i) => `q${i}`);
		const next = addRecent(many, "new");
		expect(next).toHaveLength(RECENT_MAX);
		expect(next[0]).toBe("new");
	});
});

describe("parseRecents", () => {
	it("reads a saved list and drops bad entries", () => {
		expect(parseRecents('["a", 3, "", "b"]')).toEqual(["a", "b"]);
		expect(parseRecents("not json")).toEqual([]);
		expect(parseRecents('{"a":1}')).toEqual([]);
		expect(parseRecents(null)).toEqual([]);
	});
});

describe("groupsOf", () => {
	it("keeps screen order and leaves out empty groups and categories", () => {
		const result = {
			groups: [
				{ type: "expenses", items: [], nextCursor: null },
				{
					type: "people",
					items: [
						{
							type: "person",
							participantType: "user",
							id: "p1",
							name: "Ana",
							username: null,
						},
					],
					nextCursor: null,
				},
				{
					type: "categories",
					items: [
						{ type: "category", id: "c1", name: "Food", color: "red" },
					],
					nextCursor: null,
				},
				{
					type: "projects",
					items: [
						{ type: "project", id: "j1", name: "Trip", status: "ACTIVE" },
					],
					nextCursor: null,
				},
			],
		} as unknown as SearchResult;
		expect(groupsOf(result).map((g) => g.type)).toEqual(["people", "projects"]);
	});
});

describe("matchPlaces", () => {
	const all = places();
	const nameOf = (p: { label: string }) => p.label;

	it("lists every page for an empty query", () => {
		expect(matchPlaces(all, nameOf, "")).toHaveLength(all.length);
	});

	it("matches inside the name, ignoring case and accents", () => {
		const named = (p: { label: string }) =>
			p.label === "currencies" ? "Monedas Ñandú" : p.label;
		expect(matchPlaces(all, named, "nandu").map((p) => p.id)).toEqual([
			"currencies",
		]);
		expect(matchPlaces(all, nameOf, "BUDG").map((p) => p.id)).toEqual([
			"budget",
		]);
	});
});
