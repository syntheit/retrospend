import { createElement } from "react";
import { createReadCache } from "@/data/cache";
import { createMemoryStore } from "@/data/store";
import { tokenKey } from "./token-store";
import { SessionProvider, type SessionState, useSession } from "./session";

// The cold start: what the session says on each render while the saved
// server and the keystore are read and /me is checked. Sign-in must never be
// shown on the way to Home.

const renderer = require("react-test-renderer");
const { act, create } = renderer;

const BASE = "https://srv.example";
const me = { id: "u1", name: "Ana" };

const mockStore = createMemoryStore();
const mockKeystore = new Map<string, string>();
let mockConnection: { status: string; baseUrl?: string } = { status: "loading" };
let mockMe: () => Promise<unknown> = async () => me;

jest.mock("@/data/sqlite-store", () => ({
	// Called when session.tsx loads, before the store below exists.
	createSqliteStore: () => ({
		get: (k: string) => mockStore.get(k),
		set: (k: string, v: string) => mockStore.set(k, v),
		delete: (k: string) => mockStore.delete(k),
		keys: (p: string) => mockStore.keys(p),
	}),
}));
jest.mock("@/lib/secure-store", () => ({
	secureStore: {
		getItemAsync: async (k: string) => mockKeystore.get(k) ?? null,
		setItemAsync: async (k: string, v: string) => {
			mockKeystore.set(k, v);
		},
		deleteItemAsync: async (k: string) => {
			mockKeystore.delete(k);
		},
	},
}));
jest.mock("@/auth/server-connection", () => ({
	useServerConnection: () => ({ connection: mockConnection }),
}));
jest.mock("@retrospend/api-client", () => ({
	createRetrospendClient: () => ({ platform: { me: () => mockMe() } }),
}));
jest.mock("./auth-api", () => ({
	createAuthApi: () => ({ clearLocal: async () => undefined }),
}));
jest.mock("@/features/feedback/runtime", () => ({
	getErrorLog: () => ({ clear: async () => undefined }),
}));
jest.mock("@/features/settings/security/exportFiles", () => ({
	sweepExports: () => undefined,
}));
jest.mock("@/push/control", () => ({
	createPushControl: () => null,
	forgetServerPush: async () => undefined,
}));

const seen: SessionState[] = [];
function Probe() {
	seen.push(useSession().state);
	return null;
}

async function boot(opts: { token: boolean; cached: boolean }) {
	seen.length = 0;
	mockKeystore.clear();
	await mockStore.set("app:first-run", "x");
	if (opts.token) mockKeystore.set(tokenKey(BASE), "t");
	if (opts.cached) await createReadCache(mockStore, BASE).write("me", 1, me);
	mockConnection = { status: "loading" };
	let tree: { update(el: unknown): void };
	await act(async () => {
		tree = create(createElement(SessionProvider, null, createElement(Probe)));
	});
	return () => {
		// The saved server is read: the connection turns connected.
		mockConnection = { status: "connected", baseUrl: BASE };
		tree.update(createElement(SessionProvider, null, createElement(Probe)));
	};
}

async function coldStart(opts: { token: boolean; cached: boolean }) {
	const connect = await boot(opts);
	await act(async () => {
		connect();
	});
}

const statuses = () => seen.map((s) => s.status);

afterEach(() => {
	jest.useRealTimers();
	mockMe = async () => me;
});

describe("cold start", () => {
	it("opens signed in from the cache with no signed-out render in between", async () => {
		await coldStart({ token: true, cached: true });
		expect(statuses()).not.toContain("signedOut");
		expect(statuses()[0]).toBe("loading");
		expect(seen.at(-1)).toMatchObject({ status: "signedIn", offline: false });
	});

	it("is signed in before /me answers", async () => {
		mockMe = () => new Promise(() => {});
		await coldStart({ token: true, cached: true });
		expect(seen.at(-1)).toMatchObject({ status: "signedIn", me });
		expect(statuses()).not.toContain("signedOut");
	});

	it("ends the session when /me says 401 after the optimistic open", async () => {
		let reject: (e: unknown) => void = () => {};
		mockMe = () => new Promise((_, r) => (reject = r));
		await coldStart({ token: true, cached: true });
		expect(seen.at(-1)).toMatchObject({ status: "signedIn", me });
		await act(async () => {
			reject({ status: 401 });
		});
		expect(seen.at(-1)).toEqual({ status: "signedOut", expired: true });
		expect(mockKeystore.has(tokenKey(BASE))).toBe(false);
	});

	it("falls back to offline after the timeout when /me hangs and nothing is cached", async () => {
		jest.useFakeTimers();
		mockMe = () => new Promise(() => {});
		const connect = await boot({ token: true, cached: false });
		await act(async () => {
			connect();
			await jest.advanceTimersByTimeAsync(3900);
		});
		expect(statuses()).toEqual(["loading", "loading"]);
		await act(async () => {
			await jest.advanceTimersByTimeAsync(4100);
		});
		expect(seen.at(-1)).toMatchObject({
			status: "signedIn",
			me: null,
			offline: true,
		});
		expect(statuses()).not.toContain("signedOut");
	});

	it("goes to sign-in when there is no token", async () => {
		await coldStart({ token: false, cached: false });
		expect(seen.at(-1)).toEqual({ status: "signedOut", expired: false });
		expect(statuses()).not.toContain("signedIn");
	});

	it("goes to sign-in when no server is saved", async () => {
		seen.length = 0;
		mockConnection = { status: "loading" };
		let tree: { update(el: unknown): void };
		await act(async () => {
			tree = create(createElement(SessionProvider, null, createElement(Probe)));
		});
		expect(seen.at(-1)).toEqual({ status: "loading" });
		mockConnection = { status: "none" };
		await act(async () => {
			tree.update(createElement(SessionProvider, null, createElement(Probe)));
		});
		expect(seen.at(-1)).toEqual({ status: "signedOut", expired: false });
	});
});
