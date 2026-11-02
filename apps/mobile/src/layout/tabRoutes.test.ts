import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { deviceRoute, type TabRouteFlags } from "./tabRoutes";

// Only the screens declared in the tabs layout are tabs; a path naming any
// other tab route lands on Home. Links go to the screen that holds the page.

const PHONE: TabRouteFlags = {
	projects: false,
	recurring: false,
	currencies: false,
	sidebar: false,
};
const IPAD: TabRouteFlags = { ...PHONE, projects: true, sidebar: true };

describe("deviceRoute", () => {
	it("sends sidebar-only and legacy tab routes to their phone screen", () => {
		expect(deviceRoute("/projects/p1?link=1", PHONE)).toBe(
			"/people/project/p1?link=1",
		);
		expect(deviceRoute("/projects", PHONE)).toBe("/people?segment=projects");
		expect(deviceRoute("/recurring", PHONE)).toBe(
			"/activity?segment=recurring",
		);
		expect(deviceRoute("/currencies", PHONE)).toBe("/settings/currencies");
		expect(deviceRoute("/preferences", PHONE)).toBe("/settings");
		expect(deviceRoute("/insights", PHONE)).toBe("/home/insights");
	});

	it("keeps the query and leaves real routes alone", () => {
		expect(deviceRoute("/recurring?x=1", PHONE)).toBe(
			"/activity?segment=recurring&x=1",
		);
		for (const path of [
			"/home",
			"/activity",
			"/budget",
			"/people/abc",
			"/settings/profile",
		]) {
			expect(deviceRoute(path, PHONE)).toBe(path);
		}
	});

	it("leaves the iPad sidebar's own tabs", () => {
		expect(deviceRoute("/projects/p1", IPAD)).toBe("/projects/p1");
		expect(deviceRoute("/preferences", IPAD)).toBe("/preferences");
		expect(deviceRoute("/insights", IPAD)).toBe("/insights");
	});
});

// A router call that names a tab route straight from a string skips the
// mapping. Only these files may, each behind the flag that makes it a tab.
const ALLOWED = new Set([
	"features/account/places.ts",
	"features/projects/openProject.ts",
	"features/search/rules.ts",
	"layout/destinations.ts",
	"layout/tabRoutes.ts",
	"layout/tabRoutes.test.ts",
]);
const SRC = join(__dirname, "..");
const APP = join(SRC, "..", "app");

function files(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? files(path) : [path];
	});
}

describe("tab routes in code", () => {
	it("are named by string only where a flag makes them tabs", () => {
		const literal =
			/["'`]\/(projects|recurring|currencies|preferences|insights)(["'`/?[]|$)/;
		const offenders = [...files(SRC), ...files(APP)]
			.filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path))
			.filter((path) => !path.startsWith(APP))
			.filter((path) => !ALLOWED.has(relative(SRC, path)))
			.filter((path) => literal.test(readFileSync(path, "utf8")))
			.map((path) => relative(SRC, path));
		expect(offenders).toEqual([]);
	});
});
