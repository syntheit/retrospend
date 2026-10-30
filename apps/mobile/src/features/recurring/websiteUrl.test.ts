import { readWebsite } from "./websiteUrl";

describe("readWebsite", () => {
	it("treats blank as no website", () => {
		expect(readWebsite("   ")).toBeNull();
	});

	it("adds https to a bare host", () => {
		expect(readWebsite(" streamly.com/plans ")).toBe(
			"https://streamly.com/plans",
		);
	});

	it("keeps a scheme that is already there", () => {
		expect(readWebsite("http://example.com")).toBe("http://example.com");
	});

	it("rejects what cannot be an address", () => {
		expect(readWebsite("streamly")).toBe("invalid");
		expect(readWebsite("two words.com")).toBe("invalid");
		expect(readWebsite(`example.com/${"a".repeat(600)}`)).toBe("invalid");
	});
});
