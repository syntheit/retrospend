import {
	orderSessions,
	passwordChecks,
	passwordReady,
	sessionName,
} from "./rules";

describe("password rules", () => {
	it("checks length, both cases and a number", () => {
		expect(passwordChecks("")).toEqual({
			length: false,
			case: false,
			number: false,
		});
		expect(passwordChecks("abcdefgh")).toEqual({
			length: true,
			case: false,
			number: false,
		});
		expect(passwordChecks("Abcdefg1")).toEqual({
			length: true,
			case: true,
			number: true,
		});
		expect(passwordChecks("x".repeat(256)).length).toBe(false);
	});

	it("is ready only with the current password, every rule and a match", () => {
		const next = "Battery staple 2";
		expect(passwordReady({ current: "old", next, confirm: next })).toBe(true);
		expect(passwordReady({ current: "", next, confirm: next })).toBe(false);
		expect(passwordReady({ current: "old", next, confirm: "other" })).toBe(
			false,
		);
		expect(
			passwordReady({ current: "old", next: "short", confirm: "short" }),
		).toBe(false);
	});
});

describe("sessionName", () => {
	it("names device clients by their id", () => {
		expect(
			sessionName({
				kind: "device",
				clientId: "retrospend-cli",
				userAgent: null,
			}),
		).toEqual({ key: "cli" });
		expect(
			sessionName({
				kind: "device",
				clientId: "something-else",
				userAgent: null,
			}),
		).toEqual({ key: "device" });
	});

	it("names the app with its system", () => {
		expect(
			sessionName({
				kind: "mobile",
				clientId: "retrospend-mobile",
				userAgent: "Retrospend/1 CFNetwork/3826 Darwin/24.0.0 iPhone",
			}),
		).toEqual({ key: "app", system: "iOS" });
		expect(
			sessionName({
				kind: "mobile",
				clientId: "retrospend-mobile",
				userAgent: "okhttp/4.12.0",
			}),
		).toEqual({ key: "app", system: "Android" });
	});

	it("names browsers, Edge before Chrome and Chrome before Safari", () => {
		const web = (userAgent: string) =>
			sessionName({ kind: "web", clientId: null, userAgent });
		expect(
			web(
				"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
			),
		).toEqual({ key: "browser", browser: "Chrome", system: "macOS" });
		expect(
			web(
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0",
			),
		).toEqual({ key: "browser", browser: "Edge", system: "Windows" });
		expect(
			web(
				"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
			),
		).toEqual({ key: "browser", browser: "Safari", system: "iOS" });
		expect(
			web(
				"Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
			),
		).toEqual({ key: "browser", browser: "Firefox", system: "Linux" });
		expect(
			sessionName({ kind: "web", clientId: null, userAgent: null }),
		).toEqual({ key: "web", system: null });
	});
});

describe("orderSessions", () => {
	it("puts the current session first, then the most recently used", () => {
		const list = [
			{ id: "a", current: false, lastUsedAt: "2026-10-01T00:00:00.000Z" },
			{ id: "b", current: true, lastUsedAt: "2026-09-01T00:00:00.000Z" },
			{ id: "c", current: false, lastUsedAt: "2026-10-20T00:00:00.000Z" },
		];
		expect(orderSessions(list).map((s) => s.id)).toEqual(["b", "c", "a"]);
	});
});
