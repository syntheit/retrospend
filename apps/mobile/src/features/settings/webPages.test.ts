jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));

import { WEB_PAGES, webUrl } from "./webPages";

describe("webUrl", () => {
	it("joins the server and the page without a double slash", () => {
		expect(webUrl("https://retrospend.app", "/import")).toBe(
			"https://retrospend.app/import",
		);
		expect(webUrl("https://retrospend.app/", "/settings#data")).toBe(
			"https://retrospend.app/settings#data",
		);
	});

	it("keeps a path server prefix", () => {
		expect(webUrl("https://host.example/rs", "/currencies")).toBe(
			"https://host.example/rs/currencies",
		);
	});

	it("lists each web-only page once", () => {
		const ids = WEB_PAGES.map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
