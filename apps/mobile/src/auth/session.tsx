// Who is signed in. The bearer token is in the keystore (token-store.ts, one
// per server); the profile is cached so the app opens offline. A 401 from API
// v1 means the session ended (60 days, signed out elsewhere, account turned
// off): the token and everything cached for the account are dropped and the
// sign-in screen says so. Unsynced changes (the outbox) are kept.
import {
	createRetrospendClient,
	type RetrospendClient,
} from "@retrospend/api-client";
import type { Me } from "@retrospend/api-contract";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useServerConnection } from "@/auth/server-connection";
import { createReadCache, type ReadCache } from "@/data/cache";
import { createOutbox, type Outbox } from "@/data/outbox";
import { createSqliteStore } from "@/data/sqlite-store";
import { createPushControl, forgetServerPush } from "@/push/control";
import { type AuthApi, createAuthApi, type SignInStep } from "./auth-api";
import { isSessionEnded } from "./errors";
import { clearStaleTokenOnFirstRun } from "./first-run";
import { type FetchMe, ME_CACHE, restoreSession } from "./restore";
import { createTokenStore } from "./token-store";

export type SessionState =
	| { status: "loading" }
	| { status: "signedOut"; expired: boolean }
	| {
			status: "signedIn";
			me: Me | null;
			offline: boolean;
			offlineSince: string | null;
	  };

type Local = { cache: ReadCache; outbox: Outbox };

interface SessionValue {
	state: SessionState;
	signIn(email: string, password: string): Promise<SignInStep>;
	verifyCode(code: string): Promise<SignInStep>;
	/** Changes made on this phone that the server does not have yet. */
	unsyncedCount(): Promise<number>;
	/**
	 * Reads the profile again (home currency, language) and rewrites its
	 * cache. Settings calls it after a change that the rest of the app reads
	 * from `state.me`.
	 */
	refreshMe(): Promise<void>;
	/** `discardUnsynced` drops the outbox; the screen asks first. */
	signOut(options?: { discardUnsynced?: boolean }): Promise<void>;
	/** Null until a server is connected. */
	api: RetrospendClient | null;
	/** The local store for the signed-in account. */
	local: Local | null;
}

const SessionContext = createContext<SessionValue | null>(null);
const store = createSqliteStore();

/** Push for the account that is signed in, for the steps that end its session. */
function pushOf(
	baseUrl: string | null,
	me: Me | null,
	api: RetrospendClient | null,
) {
	return baseUrl && me
		? createPushControl({
				store,
				api,
				who: { baseUrl, meId: me.id },
				sandbox: false,
			})
		: null;
}

export function SessionProvider({ children }: { children: ReactNode }) {
	const { connection } = useServerConnection();
	const baseUrl = connection.status === "connected" ? connection.baseUrl : null;
	const [state, setState] = useState<SessionState>({ status: "loading" });

	const tokens = useMemo(
		() => (baseUrl ? createTokenStore(baseUrl) : null),
		[baseUrl],
	);
	const authApi = useMemo<AuthApi | null>(
		() => (baseUrl && tokens ? createAuthApi(baseUrl, tokens) : null),
		[baseUrl, tokens],
	);
	const profileCache = useMemo(
		() => (baseUrl ? createReadCache(store, baseUrl) : null),
		[baseUrl],
	);

	const meId = state.status === "signedIn" ? (state.me?.id ?? null) : null;
	const local = useMemo<Local | null>(() => {
		if (!baseUrl || !meId) return null;
		const scope = `${baseUrl}|${meId}`;
		return {
			cache: createReadCache(store, scope),
			outbox: createOutbox(store, scope),
		};
	}, [baseUrl, meId]);

	// What the 401 handler needs, as of the latest render.
	const me = state.status === "signedIn" ? state.me : null;
	const latest = useRef({ tokens, authApi, profileCache, local, baseUrl, me });
	latest.current = { tokens, authApi, profileCache, local, baseUrl, me };

	/**
	 * The session ended on the server: forget it here, keep the outbox. `me`
	 * is null when it ended before the app opened; the push state of this
	 * server goes all the same.
	 */
	const forgetEnded = useCallback(async (meId: string | null) => {
		const { authApi, local, baseUrl } = latest.current;
		if (!baseUrl) return;
		await Promise.all([
			// The server already dropped this session's devices; stop polling here.
			forgetServerPush(store, baseUrl, meId),
			local
				? local.cache.clear()
				: meId
					? createReadCache(store, `${baseUrl}|${meId}`).clear()
					: undefined,
			authApi?.clearLocal(),
		]);
	}, []);

	const expire = useCallback(async () => {
		const { tokens, profileCache, me } = latest.current;
		setState({ status: "signedOut", expired: true });
		await Promise.all([
			forgetEnded(me?.id ?? null),
			tokens?.clear(),
			profileCache?.clear(),
		]);
	}, [forgetEnded]);

	const api = useMemo(
		() =>
			baseUrl && tokens
				? createRetrospendClient({
						baseUrl,
						authHeaders: async (): Promise<Record<string, string>> => {
							const token = await tokens.get();
							return token ? { authorization: `Bearer ${token}` } : {};
						},
						fetch: async (input, init) => {
							const response = await fetch(input, init);
							if (response.status === 401) expire();
							return response;
						},
					})
				: null,
		[baseUrl, tokens, expire],
	);

	const fetchMe = useCallback(async (): Promise<FetchMe> => {
		if (!api) return { ok: false, reason: "offline" };
		try {
			return { ok: true, me: await api.platform.me() };
		} catch (error) {
			return {
				ok: false,
				reason: isSessionEnded(error) ? "unauthorized" : "offline",
			};
		}
	}, [api]);

	useEffect(() => {
		if (!baseUrl || !tokens || !profileCache) {
			setState({ status: "signedOut", expired: false });
			return;
		}
		let cancelled = false;
		clearStaleTokenOnFirstRun(store, tokens)
			.then(() =>
				restoreSession({
					tokens,
					fetchMe,
					profileCache,
					ended: forgetEnded,
				}),
			)
			.then((restored) => {
				if (!cancelled) setState(restored);
			});
		return () => {
			cancelled = true;
		};
	}, [baseUrl, tokens, fetchMe, profileCache, forgetEnded]);

	const finishSignIn = useCallback(
		async (step: SignInStep) => {
			if (step.status !== "signedIn") return step;
			const me = await fetchMe();
			if (!me.ok) {
				await tokens?.clear();
				return { status: "error", reason: "network" } as const;
			}
			await profileCache?.write(ME_CACHE.name, ME_CACHE.schema, me.me);
			setState({
				status: "signedIn",
				me: me.me,
				offline: false,
				offlineSince: null,
			});
			return step;
		},
		[fetchMe, profileCache, tokens],
	);

	const value = useMemo<SessionValue>(
		() => ({
			state,
			api,
			local,
			signIn: async (email, password) =>
				finishSignIn(
					authApi
						? await authApi.signIn(email, password)
						: { status: "error", reason: "unknown" },
				),
			verifyCode: async (code) =>
				finishSignIn(
					authApi
						? await authApi.verifyCode(code)
						: { status: "error", reason: "unknown" },
				),
			async refreshMe() {
				const fresh = await fetchMe();
				if (!fresh.ok) return;
				await profileCache?.write(ME_CACHE.name, ME_CACHE.schema, fresh.me);
				setState((prev) =>
					prev.status === "signedIn"
						? { ...prev, me: fresh.me, offline: false, offlineSince: null }
						: prev,
				);
			},
			unsyncedCount: async () => (await local?.outbox.all())?.length ?? 0,
			async signOut(options) {
				// First: removing the device needs the session this ends.
				await pushOf(baseUrl, me, api)
					?.disable()
					.catch(() => undefined);
				await authApi?.signOut();
				if (options?.discardUnsynced) await local?.outbox.clear();
				await Promise.all([
					// Also when the profile never loaded: no push state outlives it.
					baseUrl ? forgetServerPush(store, baseUrl, me?.id ?? null) : null,
					tokens?.clear(),
					profileCache?.clear(),
					local?.cache.clear(),
					authApi?.clearLocal(),
				]);
				setState({ status: "signedOut", expired: false });
			},
		}),
		[
			state,
			api,
			local,
			authApi,
			tokens,
			finishSignIn,
			profileCache,
			fetchMe,
			baseUrl,
			me,
		],
	);

	return (
		<SessionContext.Provider value={value}>{children}</SessionContext.Provider>
	);
}

export function useSession(): SessionValue {
	const value = useContext(SessionContext);
	if (!value) throw new Error("useSession needs a SessionProvider above it");
	return value;
}
