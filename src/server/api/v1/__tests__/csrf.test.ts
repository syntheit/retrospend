import { describe, expect, it } from "vitest";
import { appOriginFrom, isCrossSiteWrite } from "../csrf";

const APP = "https://retro.example.com";
const h = (init: Record<string, string>) => new Headers(init);

describe("isCrossSiteWrite", () => {
	it("refuses a browser write from another site or a sibling", () => {
		expect(isCrossSiteWrite(h({ "sec-fetch-site": "cross-site" }), APP)).toBe(
			true,
		);
		expect(isCrossSiteWrite(h({ "sec-fetch-site": "same-site" }), APP)).toBe(
			true,
		);
	});

	it("refuses an Origin that is not the app, including null and junk", () => {
		expect(isCrossSiteWrite(h({ origin: "https://evil.example" }), APP)).toBe(
			true,
		);
		expect(isCrossSiteWrite(h({ origin: "null" }), APP)).toBe(true);
		expect(isCrossSiteWrite(h({ origin: "not a url" }), APP)).toBe(true);
		// Same host with another scheme or port is another origin.
		expect(
			isCrossSiteWrite(h({ origin: "http://retro.example.com" }), APP),
		).toBe(true);
		expect(
			isCrossSiteWrite(h({ origin: "https://retro.example.com:8443" }), APP),
		).toBe(true);
	});

	it("lets the app's own pages through", () => {
		expect(
			isCrossSiteWrite(
				h({ "sec-fetch-site": "same-origin", origin: APP }),
				APP,
			),
		).toBe(false);
		expect(isCrossSiteWrite(h({ origin: APP }), APP)).toBe(false);
	});

	it("accepts the request's own Host when no public URL is configured", () => {
		expect(
			isCrossSiteWrite(
				h({ origin: "http://localhost:3165", host: "localhost:3165" }),
				null,
			),
		).toBe(false);
		expect(
			isCrossSiteWrite(
				h({ origin: "http://evil.example", host: "localhost:3165" }),
				null,
			),
		).toBe(true);
	});

	it("passes a request with neither header (curl, server calls)", () => {
		expect(isCrossSiteWrite(h({}), APP)).toBe(false);
		expect(isCrossSiteWrite(h({ "sec-fetch-site": "none" }), APP)).toBe(false);
	});
});

describe("appOriginFrom", () => {
	it("reads the origin of the public URL", () => {
		expect(appOriginFrom("https://retro.example.com/base/")).toBe(APP);
		expect(appOriginFrom(undefined)).toBeNull();
		expect(appOriginFrom("nope")).toBeNull();
	});
});
