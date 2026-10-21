import { describe, expect, it } from "vitest";
import { requestTimeZone } from "../time-zone";

describe("requestTimeZone", () => {
	it("prefers the x-timezone header", () => {
		const headers = new Headers({
			"x-timezone": "America/Argentina/Buenos_Aires",
			cookie: "tz=Europe%2FBerlin",
		});
		expect(requestTimeZone(headers)).toBe("America/Argentina/Buenos_Aires");
	});

	it("falls back to the tz cookie (server components)", () => {
		const headers = new Headers({
			cookie: "theme=dark; tz=Europe%2FBerlin; other=1",
		});
		expect(requestTimeZone(headers)).toBe("Europe/Berlin");
	});

	it("ignores invalid zones and missing headers", () => {
		expect(requestTimeZone(new Headers({ "x-timezone": "Mars/Base" }))).toBeUndefined();
		expect(requestTimeZone(new Headers({ cookie: "tz=%E0%A4%A" }))).toBeUndefined();
		expect(requestTimeZone(new Headers())).toBeUndefined();
		expect(requestTimeZone(undefined)).toBeUndefined();
	});
});
