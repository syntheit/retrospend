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
		expect(layoutFor(393, IPHONE, 852)).toMatchObject({
			widthClass: "compact",
			tablet: false,
			navigation: "bar",
			listDetail: false,
		});
		expect(layoutFor(852, IPHONE, 393).widthClass).toBe("compact");
	});

	it("goes list-detail on iPad from the regular (medium) width", () => {
		expect(layoutFor(820, IPAD, 1180)).toMatchObject({
			widthClass: "medium",
			listDetail: true,
			navigation: "native",
			columns: false,
		});
		expect(layoutFor(1180, IPAD, 820).widthClass).toBe("expanded");
		expect(layoutFor(507, IPAD, 800).listDetail).toBe(false); // Slide Over
	});

	it("goes list-detail on Android tablets from medium", () => {
		expect(layoutFor(500, ANDROID, 900).listDetail).toBe(false);
		expect(layoutFor(700, ANDROID, 1000).listDetail).toBe(true);
		expect(layoutFor(900, ANDROID, 1200).listDetail).toBe(true);
	});

	it("picks the Android chrome from size and orientation", () => {
		expect(layoutFor(393, ANDROID, 852).navigation).toBe("bar");
		expect(layoutFor(700, ANDROID, 1000).navigation).toBe("rail");
		expect(layoutFor(840, ANDROID, 1200).navigation).toBe("rail"); // portrait
		expect(layoutFor(1280, ANDROID, 800).navigation).toBe("sidebar");
	});

	it("adds columns only at expanded", () => {
		expect(layoutFor(820, ANDROID, 1180).columns).toBe(false);
		expect(layoutFor(1280, ANDROID, 800).columns).toBe(true);
	});
});
