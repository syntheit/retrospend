import { entryHref, isHomePath, personHref, projectHref } from "./detailRoutes";

jest.mock("expo-router", () => ({ usePathname: () => "/" }));
jest.mock("./destinations", () => ({
	projectRoute: (id: string) => ({
		pathname: "/people/project/[id]",
		params: { id },
	}),
}));

describe("detail routes", () => {
	it("keeps a detail opened from Home inside Home's stack", () => {
		expect(entryHref("e1", true)).toEqual({
			pathname: "/home/entry/[id]",
			params: { id: "e1" },
		});
		expect(entryHref("e1", true, "{}")).toEqual({
			pathname: "/home/entry/[id]",
			params: { id: "e1", row: "{}" },
		});
		expect(personHref("user", "p1", true)).toEqual({
			pathname: "/home/person/[type]/[id]",
			params: { type: "user", id: "p1" },
		});
		expect(projectHref("pr1", true)).toEqual({
			pathname: "/home/project/[id]",
			params: { id: "pr1" },
		});
	});

	it("opens in the tab that owns it otherwise", () => {
		expect(entryHref("e1", false)).toEqual({
			pathname: "/activity/[id]",
			params: { id: "e1" },
		});
		expect(personHref("user", "p1", false)).toEqual({
			pathname: "/people/[type]/[id]",
			params: { type: "user", id: "p1" },
		});
		expect(projectHref("pr1", false)).toEqual({
			pathname: "/people/project/[id]",
			params: { id: "pr1" },
		});
	});

	it("knows Home's stack by its path", () => {
		expect(isHomePath("/")).toBe(true);
		expect(isHomePath("/home")).toBe(true);
		expect(isHomePath("/home/search")).toBe(true);
		expect(isHomePath("/home/entry/e1")).toBe(true);
		expect(isHomePath("/homework")).toBe(false);
		expect(isHomePath("/activity")).toBe(false);
	});
});
