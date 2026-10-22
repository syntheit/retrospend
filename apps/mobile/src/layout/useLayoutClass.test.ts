import { layoutFor, widthClassFor } from "./useLayoutClass";

describe("widthClassFor", () => {
	it.each([
		[393, "compact"], // iPhone 15, portrait
		[599, "compact"],
		[600, "medium"],
		[820, "medium"], // iPad Air 11, portrait
		[839, "medium"],
		[840, "expanded"],
		[1180, "expanded"], // iPad Air 11, landscape
	])("%d dp is %s", (width, expected) => {
		expect(widthClassFor(width)).toBe(expected);
	});
});

describe("layoutFor", () => {
	it("goes list-detail on iPad from the regular (medium) width", () => {
		expect(layoutFor(820, "ios")).toEqual({
			widthClass: "medium",
			listDetail: true,
		});
		expect(layoutFor(393, "ios").listDetail).toBe(false);
	});

	it("goes list-detail on Android only when expanded", () => {
		expect(layoutFor(700, "android").listDetail).toBe(false);
		expect(layoutFor(900, "android").listDetail).toBe(true);
	});
});
