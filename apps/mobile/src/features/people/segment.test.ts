import { parseSegment } from "./segment";

jest.mock("expo-sqlite/kv-store", () => ({
	__esModule: true,
	default: { getItemSync: jest.fn(), setItemSync: jest.fn() },
}));

describe("parseSegment", () => {
	it("accepts the two segments", () => {
		expect(parseSegment("people")).toBe("people");
		expect(parseSegment("projects")).toBe("projects");
	});

	it("rejects anything else, so a bad link falls back to the saved choice", () => {
		expect(parseSegment(undefined)).toBeNull();
		expect(parseSegment("Projects")).toBeNull();
		expect(parseSegment(["projects"])).toBeNull();
	});
});
