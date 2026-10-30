jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));

import { webUrl } from "./webPages";

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
});
