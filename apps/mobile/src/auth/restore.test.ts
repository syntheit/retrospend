import type { Me } from "@retrospend/api-contract";
import { createReadCache } from "@/data/cache";
import { createMemoryStore } from "@/data/store";
import { authFailureOf, isSessionEnded } from "./errors";
import { endSession, type FetchMe, openSession, restoreSession } from "./restore";
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

	it("hands the account over when the 401 handler ends the session during the restore", async () => {
		const ended = jest.fn(async (_meId: string | null) => undefined);
		const s = setup("t", { ok: false, reason: "unauthorized" }, ended);
		await s.profileCache.write("me", 1, me);
		// The fetch wrapper's 401 handler runs alongside, knowing nobody yet.
		await Promise.all([
			endSession({
				tokens: s.tokens,
				profileCache: s.profileCache,
				ended,
				meId: null,
			}),
			s.run(),
		]);
		expect(ended).toHaveBeenCalledWith("u1");
		expect(s.token()).toBeNull();
		expect(await s.profileCache.read("me", 1)).toBeNull();
	});

	it("ends the session for the account the caller names", async () => {
		const ended = jest.fn(async (_meId: string | null) => undefined);
		const s = setup("t", { ok: true, me });
		await endSession({
			tokens: s.tokens,
			profileCache: s.profileCache,
			ended,
			meId: "u2",
		});
		expect(ended).toHaveBeenCalledWith("u2");
		expect(s.token()).toBeNull();
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

describe("openSession", () => {
	function open(
		token: string | null,
		fetchMe: () => Promise<FetchMe>,
		cached: boolean,
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
			token: () => current,
			run: async () => {
				if (cached) await profileCache.write("me", 1, me);
				return openSession({
					tokens,
					profileCache,
					fetchMe,
					timeoutMs: 4000,
				});
			},
		};
	}

	afterEach(() => jest.useRealTimers());

	it("goes to sign-in at once with no token", async () => {
		const fetchMe = jest.fn(async (): Promise<FetchMe> => ({ ok: true, me }));
		const o = open(null, fetchMe, true);
		const opening = await o.run();
		expect(opening.first).toEqual({ status: "signedOut", expired: false });
		expect(await opening.settled).toBeNull();
		expect(fetchMe).not.toHaveBeenCalled();
	});

	it("opens signed in from the cache without waiting for the server", async () => {
		const o = open("t", () => new Promise<FetchMe>(() => {}), true);
		const opening = await o.run();
		expect(opening.first).toEqual({
			status: "signedIn",
			me,
			offline: false,
			offlineSince: null,
		});
	});

	it("verifies in the background and keeps the session when the server agrees", async () => {
		const fresh = { id: "u1", name: "Ana B" } as Me;
		const o = open("t", async () => ({ ok: true, me: fresh }), true);
		const opening = await o.run();
		expect(await opening.settled).toMatchObject({
			status: "signedIn",
			me: fresh,
			offline: false,
		});
	});

	it("ends the session when the server says 401 after the optimistic open", async () => {
		const o = open("t", async () => ({ ok: false, reason: "unauthorized" }), true);
		const opening = await o.run();
		expect(opening.first.status).toBe("signedIn");
		expect(await opening.settled).toEqual({ status: "signedOut", expired: true });
		expect(o.token()).toBeNull();
		expect(await o.profileCache.read("me", 1)).toBeNull();
	});

	it("marks the cached session offline when the server cannot be reached", async () => {
		const o = open("t", async () => ({ ok: false, reason: "offline" }), true);
		const opening = await o.run();
		expect(await opening.settled).toMatchObject({
			status: "signedIn",
			me,
			offline: true,
		});
		expect(o.token()).toBe("t");
	});

	it("waits for the server when there is no cached profile", async () => {
		const o = open("t", async () => ({ ok: true, me }), false);
		const opening = await o.run();
		expect(opening.first).toMatchObject({ status: "signedIn", me });
		expect(await opening.settled).toBeNull();
	});

	it("falls back to offline after the timeout when the server hangs", async () => {
		jest.useFakeTimers();
		let answer: (r: FetchMe) => void = () => {};
		const o = open(
			"t",
			() => new Promise<FetchMe>((resolve) => (answer = resolve)),
			false,
		);
		let result: Awaited<ReturnType<typeof openSession>> | undefined;
		o.run().then((r) => {
			result = r;
		});
		await jest.advanceTimersByTimeAsync(3900);
		expect(result).toBeUndefined();
		await jest.advanceTimersByTimeAsync(200);
		expect(result?.first).toEqual({
			status: "signedIn",
			me: null,
			offline: true,
			offlineSince: null,
		});
		// The late answer still arrives.
		answer({ ok: true, me });
		expect(await result?.settled).toMatchObject({ status: "signedIn", me });
	});

	it("ends the session when a slow server finally says 401", async () => {
		jest.useFakeTimers();
		let answer: (r: FetchMe) => void = () => {};
		const o = open(
			"t",
			() => new Promise<FetchMe>((resolve) => (answer = resolve)),
			false,
		);
		let result: Awaited<ReturnType<typeof openSession>> | undefined;
		o.run().then((r) => {
			result = r;
		});
		await jest.advanceTimersByTimeAsync(4100);
		answer({ ok: false, reason: "unauthorized" });
		expect(await result?.settled).toEqual({ status: "signedOut", expired: true });
		expect(o.token()).toBeNull();
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
