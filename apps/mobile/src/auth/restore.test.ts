import type { Me } from "@retrospend/api-contract";
import { createReadCache } from "@/data/cache";
import { createMemoryStore } from "@/data/store";
import { authFailureOf, isSessionEnded } from "./errors";
import { type FetchMe, restoreSession } from "./restore";
import type { TokenStore } from "./token-store";

const me = { id: "u1", name: "Ana" } as Me;

function setup(
	token: string | null,
	fetchMe: FetchMe,
	ended?: (meId: string | null) => Promise<void>,
) {
	let current = token;
	const tokens: TokenStore = {
		get: async () => current,
		set: async (t) => {
			current = t;
		},
		clear: async () => {
			current = null;
		},
	};
	const profileCache = createReadCache(createMemoryStore(), "srv");
	return {
		tokens,
		profileCache,
		run: () =>
			restoreSession({
				tokens,
				profileCache,
				fetchMe: async () => fetchMe,
				ended,
			}),
		token: () => current,
	};
}

describe("restoreSession", () => {
	it("is signed out with no token", async () => {
		const s = setup(null, { ok: true, me });
		expect(await s.run()).toEqual({ status: "signedOut", expired: false });
	});

	it("signs in and caches the profile when the server accepts the token", async () => {
		const s = setup("t", { ok: true, me });
		expect(await s.run()).toEqual({
			status: "signedIn",
			me,
			offline: false,
			offlineSince: null,
		});
		expect((await s.profileCache.read("me", 1))?.data).toEqual(me);
	});

	it("forgets an expired token and says so", async () => {
		const s = setup("t", { ok: false, reason: "unauthorized" });
		await s.profileCache.write("me", 1, me);
		expect(await s.run()).toEqual({ status: "signedOut", expired: true });
		expect(s.token()).toBeNull();
		expect(await s.profileCache.read("me", 1)).toBeNull();
	});

	it("drops what a sign-out drops for the account whose session ended", async () => {
		const ended = jest.fn(async (_meId: string | null) => undefined);
		const s = setup("t", { ok: false, reason: "unauthorized" }, ended);
		await s.profileCache.write("me", 1, me);
		await s.run();
		expect(ended).toHaveBeenCalledWith("u1");
	});

	it("drops this server's state even with no cached profile", async () => {
		const ended = jest.fn(async (_meId: string | null) => undefined);
		const s = setup("t", { ok: false, reason: "unauthorized" }, ended);
		await s.run();
		expect(ended).toHaveBeenCalledWith(null);
	});

	it("stays signed in offline with the cached profile", async () => {
		const s = setup("t", { ok: false, reason: "offline" });
		await s.profileCache.write("me", 1, me);
		const result = await s.run();
		expect(result).toMatchObject({ status: "signedIn", me, offline: true });
		// "Offline since" shows when the cached profile was last fetched.
		expect(result.status === "signedIn" && result.offlineSince).toMatch(
			/^\d{4}-\d{2}-\d{2}T/,
		);
		expect(s.token()).toBe("t");
	});
});

describe("isSessionEnded", () => {
	it.each([
		[{ status: 401 }, true],
		[{ status: 403 }, true],
		[{ status: 500 }, false],
		[new Error("network"), false],
		[null, false],
	] as const)("%j is %s", (error, ended) => {
		expect(isSessionEnded(error)).toBe(ended);
	});
});

describe("authFailureOf", () => {
	it.each([
		[{ status: 401, code: "INVALID_EMAIL_OR_PASSWORD" }, "invalidCredentials"],
		[{ status: 400, code: "INVALID_CODE" }, "invalidCode"],
		[{ status: 429 }, "rateLimited"],
		[{ status: 403, code: "EMAIL_NOT_VERIFIED" }, "emailNotVerified"],
		[{ status: 500 }, "unknown"],
	] as const)("%j is %s", (error, reason) => {
		expect(authFailureOf(error)).toBe(reason);
	});
});
