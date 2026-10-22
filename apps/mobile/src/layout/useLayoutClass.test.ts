import { layoutFor, widthClassFor } from "./useLayoutClass";

const IPHONE = { os: "ios", isPad: false } as const;
const IPAD = { os: "ios", isPad: true } as const;
const ANDROID = { os: "android", isPad: false } as const;

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
	it("keeps an iPhone compact in either orientation", () => {
		const compact = { widthClass: "compact", listDetail: false };
		expect(layoutFor(393, IPHONE)).toEqual(compact);
		expect(layoutFor(852, IPHONE)).toEqual(compact); // iPhone 15, landscape
	});

	it("goes list-detail on iPad from the regular (medium) width", () => {
		expect(layoutFor(820, IPAD)).toEqual({
			widthClass: "medium",
			listDetail: true,
		});
		expect(layoutFor(1180, IPAD).widthClass).toBe("expanded");
		expect(layoutFor(507, IPAD).listDetail).toBe(false); // Slide Over
	});

	it("goes list-detail on Android only when expanded", () => {
		expect(layoutFor(700, ANDROID).listDetail).toBe(false);
		expect(layoutFor(900, ANDROID).listDetail).toBe(true);
	});
});
