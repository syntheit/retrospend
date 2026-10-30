import { nextExpanded } from "./fabScroll";

describe("nextExpanded", () => {
	it("shrinks while the list scrolls down and extends going up", () => {
		expect(nextExpanded(true, 120, 100)).toBe(false);
		expect(nextExpanded(false, 100, 120)).toBe(true);
	});

	it("is extended at the top, including a pull past it", () => {
		expect(nextExpanded(false, 0, 40)).toBe(true);
		expect(nextExpanded(false, -12, 0)).toBe(true);
	});

	it("keeps its state for a move under one point", () => {
		expect(nextExpanded(false, 100.4, 100)).toBe(false);
		expect(nextExpanded(true, 100.4, 100)).toBe(true);
	});
});
