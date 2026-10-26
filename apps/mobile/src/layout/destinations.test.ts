import { addControlFor, iosMajor } from "./destinations";

describe("addControlFor", () => {
	it("uses the tab bar's detached plus on an iPhone from iOS 26", () => {
		for (const version of ["26.0", "26.5", "27.0"]) {
			expect(addControlFor({ os: "ios", isPad: false, version })).toBe("tab");
		}
	});

	it("floats the button on an iPhone below iOS 26, where the search tab is not detached", () => {
		for (const version of ["18.6", "25.4", "17.0"]) {
			expect(addControlFor({ os: "ios", isPad: false, version })).toBe(
				"floating",
			);
		}
	});

	it("keeps the iPad's toolbar plus on any version", () => {
		for (const version of ["18.0", "26.5"]) {
			expect(addControlFor({ os: "ios", isPad: true, version })).toBe(
				"toolbar",
			);
		}
	});

	it("floats the button on Android, whatever the API level", () => {
		expect(addControlFor({ os: "android", isPad: false, version: 36 })).toBe(
			"floating",
		);
	});

	it("floats the button when the version is unreadable, the safe side", () => {
		expect(addControlFor({ os: "ios", isPad: false, version: "" })).toBe(
			"floating",
		);
	});
});

describe("iosMajor", () => {
	it("reads the major of a dotted version and is 0 off iOS", () => {
		expect(iosMajor({ os: "ios", isPad: false, version: "26.5.1" })).toBe(26);
		expect(iosMajor({ os: "android", isPad: false, version: 36 })).toBe(0);
	});
});

describe("projectRoute", () => {
	function routeOn(isPad: boolean) {
		let route: (id: string) => unknown = () => null;
		jest.isolateModules(() => {
			jest.doMock("react-native", () => ({
				Platform: { OS: "ios", isPad, Version: "26.5" },
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
});
