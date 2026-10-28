import { routeForUrl, systemPath } from "./links";
import { canonicalAmount, parsePending, parseSharedText } from "./prefill";

describe("canonicalAmount", () => {
	it.each([
		["12", "12"],
		["12.50", "12.50"],
		["12,50", "12.50"],
		["1,234", "1234"],
		["1.234", "1234"],
		["1,234.56", "1234.56"],
		["1.234,56", "1234.56"],
		["1 234,5", "1234.5"],
		["1.234.567", "1234567"],
		["007", "7"],
	])("reads %s as %s", (written, canonical) => {
		expect(canonicalAmount(written)).toBe(canonical);
	});

	it.each(["", "abc", "1,2,3,4", "1.23456", "-5"])("rejects %s", (written) => {
		expect(canonicalAmount(written)).toBeNull();
	});
});

describe("parseSharedText", () => {
	it("splits an amount from the note", () => {
		expect(parseSharedText("Coffee 4.50 at Blue Bottle")).toEqual({
			amount: "4.50",
			currency: undefined,
			title: "Coffee at Blue Bottle",
		});
	});

	it("reads a currency code on either side", () => {
		expect(parseSharedText("Lunch 12,50 EUR")).toMatchObject({
			amount: "12.50",
			currency: "EUR",
			title: "Lunch",
		});
		expect(parseSharedText("USD 9 taxi")).toMatchObject({
			amount: "9",
			currency: "USD",
			title: "taxi",
		});
	});

	it("reads a euro sign and leaves a bare dollar sign without a currency", () => {
		expect(parseSharedText("€8 sandwich")).toMatchObject({
			amount: "8",
			currency: "EUR",
		});
		expect(parseSharedText("$8 sandwich").currency).toBeUndefined();
	});

	it("keeps a text with no number as the note", () => {
		expect(parseSharedText("  Rent\nfor   May ")).toEqual({
			title: "Rent for May",
		});
	});

	it("clips a long note", () => {
		const title = parseSharedText("x".repeat(200)).title ?? "";
		expect(title.length).toBe(80);
		expect(title.endsWith("…")).toBe(true);
	});

	it("is empty for blank text", () => {
		expect(parseSharedText("   ")).toEqual({});
	});
});

describe("parsePending", () => {
	it("opens an expense with an Add expense intent's amount", () => {
		expect(parsePending('{"kind":"add","amount":12.5}')).toEqual({
			mode: "expense",
			amount: "12.5",
		});
		expect(parsePending('{"kind":"add"}')).toEqual({ mode: "expense" });
	});

	it("reads a shared text", () => {
		expect(parsePending('{"kind":"share","text":"Taxi 18"}')).toEqual({
			mode: "expense",
			amount: "18",
			currency: undefined,
			title: "Taxi",
			file: undefined,
		});
	});

	it("carries a shared receipt file", () => {
		const prefill = parsePending(
			'{"kind":"share","file":{"uri":"content://x/1","mime":"image/jpeg","name":"r.jpg"}}',
		);
		expect(prefill?.file).toEqual({
			uri: "content://x/1",
			mime: "image/jpeg",
			name: "r.jpg",
		});
	});

	it("ignores nothing, junk and unknown kinds", () => {
		expect(parsePending(null)).toBeNull();
		expect(parsePending("not json")).toBeNull();
		expect(parsePending('{"kind":"other"}')).toBeNull();
		expect(parsePending('{"kind":"share","text":"   "}')).toBeNull();
	});
});

describe("routeForUrl", () => {
	it("maps retrospend://add to the composer", () => {
		expect(routeForUrl("retrospend://add")).toEqual({
			kind: "compose",
			prefill: { mode: "expense" },
		});
		expect(
			routeForUrl(
				"retrospend://add?amount=12,50&currency=eur&title=Coffee%20beans&mode=income",
			),
		).toEqual({
			kind: "compose",
			prefill: {
				mode: "income",
				amount: "12.50",
				currency: "EUR",
				title: "Coffee beans",
			},
		});
	});

	it("drops an unreadable amount or currency", () => {
		expect(routeForUrl("retrospend://add?amount=abc&currency=dollars")).toEqual(
			{ kind: "compose", prefill: { mode: "expense" } },
		);
	});

	it("maps retrospend://share to the native hand-off", () => {
		expect(routeForUrl("retrospend://share")).toEqual({ kind: "pending" });
	});

	it("passes screen links through as routes", () => {
		expect(routeForUrl("retrospend://people/abc?tab=projects")).toEqual({
			kind: "route",
			path: "/people/abc?tab=projects",
		});
		expect(routeForUrl("/activity")).toEqual({
			kind: "route",
			path: "/activity",
		});
	});

	it("has no route for an empty link", () => {
		expect(routeForUrl("retrospend://")).toBeNull();
	});
});

describe("systemPath (+native-intent)", () => {
	it("sends the composer links to the start", () => {
		expect(systemPath("retrospend://add?amount=5")).toBe("/");
		expect(systemPath("/share")).toBe("/");
		expect(systemPath("")).toBe("/");
	});

	it("keeps screen paths", () => {
		expect(systemPath("retrospend://activity")).toBe("/activity");
		expect(systemPath("/people/abc")).toBe("/people/abc");
	});
});
