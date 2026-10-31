import {
	settingsChange,
	settingsChanged,
	settingsOf,
	showsMembers,
} from "./projectSettings";

describe("project settings", () => {
	it("reads the two switches from the page", () => {
		expect(
			settingsOf({ autoAcceptSplits: true, excludeFromAnalytics: false }),
		).toEqual({ autoAccept: true, exclude: false });
	});

	it("sends only the switch that moved", () => {
		const before = { autoAccept: false, exclude: false };
		expect(settingsChange(before, { autoAccept: true, exclude: false })).toEqual(
			{ autoAccept: true },
		);
		expect(settingsChange(before, { autoAccept: false, exclude: true })).toEqual(
			{ exclude: true },
		);
		expect(settingsChange(before, before)).toEqual({});
		expect(settingsChanged(before, before)).toBe(false);
		expect(settingsChanged(before, { autoAccept: true, exclude: true })).toBe(
			true,
		);
	});

	it("has no members to date in a solo project", () => {
		expect(showsMembers({ solo: true })).toBe(false);
		expect(showsMembers({ solo: false })).toBe(true);
	});
});
