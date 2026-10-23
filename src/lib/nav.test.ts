import { describe, expect, it } from "vitest";
import {
	ADD_ACTIONS,
	badgeText,
	currentNav,
	DESTINATIONS,
	entryOf,
	hrefOf,
	PHONE_GO_TO,
	PHONE_TABS,
	PINNED_MAX,
	PLACES,
	pinnedProjects,
	TOOLS,
} from "./nav";

const byId = (id: string) =>
	[...DESTINATIONS, ...TOOLS, ...PLACES].find((e) => e.id === id)!;

describe("nav definition", () => {
	it("has the six destinations in order, five phone tabs without Wealth", () => {
		expect(DESTINATIONS.map((d) => d.id)).toEqual([
			"home",
			"activity",
			"budget",
			"people",
			"projects",
			"wealth",
		]);
		expect(PHONE_TABS).toEqual([
			"home",
			"activity",
			"budget",
			"people",
			"projects",
		]);
		expect(TOOLS.map((t) => t.id)).toEqual(["import", "currencies"]);
	});

	it("uses every id once", () => {
		const ids = [...DESTINATIONS, ...TOOLS, ...PLACES].map((e) => e.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("links today's page until the new route ships", () => {
		const none = new Set<string>();
		expect(hrefOf(byId("home"), none)).toBe("/dashboard");
		expect(hrefOf(byId("activity"), none)).toBe("/transactions");
		expect(hrefOf(byId("recurring"), none)).toBe("/recurring");
		expect(hrefOf(byId("budget"), none)).toBe("/budget");
		// Shipped (S4B): Activity and its Recurring tab.
		expect(hrefOf(byId("activity"))).toBe("/activity");
		expect(hrefOf(byId("recurring"))).toBe("/activity/recurring");
		expect(hrefOf(byId("home"), new Set(["/home"]))).toBe("/home");
		expect(hrefOf(byId("recurring"), new Set(["/activity/recurring"]))).toBe(
			"/activity/recurring",
		);
	});

	it("hides a place that has no page yet", () => {
		expect(hrefOf(byId("insights"))).toBeNull();
		expect(hrefOf(byId("insights"), new Set(["/activity/insights"]))).toBe(
			"/activity/insights",
		);
	});
});

describe("currentNav", () => {
	it.each([
		["/dashboard", "home"],
		["/home", "home"],
		["/transactions", "activity"],
		["/recurring", "activity"],
		["/activity/recurring", "activity"],
		["/budget", "budget"],
		["/people/user/abc", "people"],
		["/projects", "projects"],
		["/projects/p1", "projects"],
		["/wealth", "wealth"],
		["/import", "import"],
		["/currencies", "currencies"],
	])("%s is %s", (path, id) => {
		expect(currentNav(path)).toBe(id);
	});

	it("matches whole path segments only", () => {
		expect(currentNav("/importer")).toBeNull();
		expect(currentNav("/settings")).toBeNull();
		expect(currentNav("/")).toBeNull();
	});
});

describe("badges", () => {
	it("shows positive counts only and caps at 99+", () => {
		expect(badgeText(undefined)).toBeNull();
		expect(badgeText(0)).toBeNull();
		expect(badgeText(-2)).toBeNull();
		expect(badgeText(3)).toBe("3");
		expect(badgeText(99)).toBe("99");
		expect(badgeText(100)).toBe("99+");
	});
});

describe("pinnedProjects", () => {
	const p = (id: string, status: "ACTIVE" | "ARCHIVED") => ({
		id,
		name: id,
		imagePath: null,
		status,
	});

	it("keeps active projects in the server's order, at most five", () => {
		const list = [
			p("a", "ACTIVE"),
			p("x", "ARCHIVED"),
			p("b", "ACTIVE"),
			p("c", "ACTIVE"),
			p("d", "ACTIVE"),
			p("e", "ACTIVE"),
			p("f", "ACTIVE"),
		];
		expect(pinnedProjects(list).map((x) => x.id)).toEqual([
			"a",
			"b",
			"c",
			"d",
			"e",
		]);
		expect(PINNED_MAX).toBe(5);
	});

	it("is empty without active projects", () => {
		expect(pinnedProjects([p("x", "ARCHIVED")])).toEqual([]);
	});
});

describe("ADD_ACTIONS", () => {
	it("is expense, income and transfer on N, I and T, all ready (4G)", () => {
		expect(ADD_ACTIONS.map((a) => [a.id, a.key, a.ready])).toEqual([
			["expense", "n", true],
			["income", "i", true],
			["transfer", "t", true],
		]);
	});
});

describe("phone Go to", () => {
	it("reaches Wealth, the tools, Recurring and Settings from the account sheet", () => {
		expect(PHONE_GO_TO.map((id) => hrefOf(entryOf(id)))).toEqual([
			"/wealth",
			"/currencies",
			"/import",
			"/activity/recurring",
			"/settings",
		]);
	});

	it("covers every place without a phone tab that has a page", () => {
		const reachable = new Set<string>([...PHONE_TABS, ...PHONE_GO_TO]);
		const missing = [...DESTINATIONS, ...TOOLS, ...PLACES]
			.filter((e) => hrefOf(e) && !reachable.has(e.id))
			.map((e) => e.id);
		expect(missing).toEqual([]);
	});
});
