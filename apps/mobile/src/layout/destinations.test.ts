import { addControlFor, iosMajor, singleAdd } from "./destinations";

describe("addControlFor", () => {
	it("floats the button above the bar on every phone, glass or not", () => {
		for (const version of ["26.0", "26.5", "27.0", "18.6", "17.0", ""]) {
			expect(addControlFor({ os: "ios", isPad: false, version })).toBe(
				"floating",
			);
		}
		expect(addControlFor({ os: "android", isPad: false, version: 36 })).toBe(
			"floating",
		);
	});

	it("keeps the iPad's toolbar plus on any version", () => {
		for (const version of ["18.0", "26.5"]) {
			expect(addControlFor({ os: "ios", isPad: true, version })).toBe(
				"toolbar",
			);
		}
	});
});

describe("iosMajor", () => {
	it("reads the major of a dotted version and is 0 off iOS", () => {
		expect(iosMajor({ os: "ios", isPad: false, version: "26.5.1" })).toBe(26);
		expect(iosMajor({ os: "android", isPad: false, version: 36 })).toBe(0);
	});
});

describe("projectRoute", () => {
	function routeOn(isPad: boolean, sidebar = true) {
		let route: (id: string) => unknown = () => null;
		jest.isolateModules(() => {
			jest.doMock("react-native", () => ({
				Platform: { OS: "ios", isPad, Version: "26.5" },
			}));
			jest.doMock("../../modules/tab-sidebar", () => ({
				TabSidebar: { isSupported: () => sidebar, configure: jest.fn() },
			}));
			route = require("./destinations").projectRoute;
		});
		return route;
	}

	it("opens a project inside People on phones", () => {
		expect(routeOn(false)("p1")).toEqual({
			pathname: "/people/project/[id]",
			params: { id: "p1" },
		});
	});

	it("opens a project in its own destination on iPad", () => {
		expect(routeOn(true)("p1")).toEqual({
			pathname: "/projects/[id]",
			params: { id: "p1" },
		});
	});

	it("opens a project inside People on an iPad without the sidebar", () => {
		expect(routeOn(true, false)("p1")).toEqual({
			pathname: "/people/project/[id]",
			params: { id: "p1" },
		});
	});
});

describe("singleAdd", () => {
	const add = {
		id: "add",
		icon: "Plus" as const,
		label: "Add",
		onPress: jest.fn(),
	};
	const more = { id: "export", label: "Export", onPress: jest.fn() };

	it("moves a page add into the overflow where the toolbar has the plus", () => {
		const out = singleAdd("toolbar", [add], [more]);
		expect(out.actions).toEqual([]);
		expect(out.overflow.map((item) => item.id)).toEqual(["add", "export"]);
	});

	it("keeps search in the bar beside the toolbar plus", () => {
		const search = { ...add, id: "search", icon: "Search" as const };
		const out = singleAdd("toolbar", [search, add], []);
		expect(out.actions).toEqual([search]);
		expect(out.overflow.map((item) => item.id)).toEqual(["add"]);
	});

	it("leaves the bar alone where the add floats", () => {
		const out = singleAdd("floating", [add], [more]);
		expect(out.actions).toEqual([add]);
		expect(out.overflow).toEqual([more]);
	});
});
