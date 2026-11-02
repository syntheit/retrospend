import { parseBasisPoints } from "./basisPoints";

describe("parseBasisPoints", () => {
	it("reads whole and decimal percents as hundredths", () => {
		expect(parseBasisPoints("12")).toBe(1200);
		expect(parseBasisPoints("12.5")).toBe(1250);
		expect(parseBasisPoints(" 0.05 ")).toBe(5);
		expect(parseBasisPoints("100")).toBe(10_000);
	});

	it("takes a comma only when asked", () => {
		expect(parseBasisPoints("12,5")).toBeNull();
		expect(parseBasisPoints("12,5", { comma: true })).toBe(1250);
	});

	it("refuses a third decimal unless it may be dropped", () => {
		expect(parseBasisPoints("24.567")).toBeNull();
		expect(parseBasisPoints("24.567", { truncate: true })).toBe(2456);
	});

	it("is null for text that is not a number", () => {
		expect(parseBasisPoints("")).toBeNull();
		expect(parseBasisPoints("abc")).toBeNull();
		expect(parseBasisPoints("1234")).toBeNull();
		expect(parseBasisPoints("-5")).toBeNull();
	});
});
