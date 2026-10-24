// Who is signed in. The bearer token is in the keystore (token-store.ts); the
// profile is cached so the app opens offline. Any API v1 answer of 401 means
// the session ended (60 days, signed out elsewhere, account turned off): the
// token is dropped and the sign-in screen says so.

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
import { type AuthApi, createAuthApi, type SignInStep } from "./auth-api";
import { type FetchMe, ME_CACHE, restoreSession } from "./restore";
import { tokenStore } from "./token-store";

export type SessionState =
	| { status: "loading" }
	| { status: "signedOut"; expired: boolean }
	| { status: "signedIn"; me: Me | null; offline: boolean };

interface SessionValue {
	state: SessionState;
	signIn(email: string, password: string): Promise<SignInStep>;
	verifyCode(code: string): Promise<SignInStep>;
	signOut(): Promise<void>;
	/** Null until a server is connected. */
	api: RetrospendClient | null;
	/** The local store for the signed-in account. */
	local: { cache: ReadCache; outbox: Outbox } | null;
}

const SessionContext = createContext<SessionValue | null>(null);
const store = createSqliteStore();

function isUnauthorized(error: unknown): boolean {
	return (error as { status?: number } | null)?.status === 401;
}

export function SessionProvider({ children }: { children: ReactNode }) {
	const { connection } = useServerConnection();
	const baseUrl = connection.status === "connected" ? connection.baseUrl : null;
	const [state, setState] = useState<SessionState>({ status: "loading" });

	const expire = useRef(() => {});
	const api = useMemo(
		() =>
			baseUrl
				? createRetrospendClient({
						baseUrl,
						authHeaders: async (): Promise<Record<string, string>> => {
							const token = await tokenStore.get();
							return token ? { authorization: `Bearer ${token}` } : {};
						},
						fetch: async (input, init) => {
							const response = await fetch(input, init);
							if (response.status === 401) expire.current();
							return response;
						},
					})
				: null,
		[baseUrl],
	);
	const authApi = useMemo<AuthApi | null>(
		() => (baseUrl ? createAuthApi(baseUrl, tokenStore) : null),
		[baseUrl],
	);
	const profileCache = useMemo(
		() => (baseUrl ? createReadCache(store, baseUrl) : null),
		[baseUrl],
	);

	const meId = state.status === "signedIn" ? (state.me?.id ?? null) : null;
	const local = useMemo(() => {
		if (!baseUrl || !meId) return null;
		const scope = `${baseUrl}|${meId}`;
		return {
			cache: createReadCache(store, scope),
			outbox: createOutbox(store, scope),
		};
	}, [baseUrl, meId]);

	const fetchMe = useCallback(async (): Promise<FetchMe> => {
		if (!api) return { ok: false, reason: "offline" };
		try {
			return { ok: true, me: await api.platform.me() };
		} catch (error) {
			return {
				ok: false,
				reason: isUnauthorized(error) ? "unauthorized" : "offline",
			};
		}
	}, [api]);

	useEffect(() => {
		if (!baseUrl || !profileCache) {
			setState({ status: "signedOut", expired: false });
			return;
		}
		let cancelled = false;
		restoreSession({ tokens: tokenStore, fetchMe, profileCache }).then(
			(restored) => {
				if (!cancelled) setState(restored);
			},
		);
		expire.current = () => {
			tokenStore.clear();
			profileCache.clear();
			setState({ status: "signedOut", expired: true });
		};
		return () => {
			cancelled = true;
		};
	}, [baseUrl, fetchMe, profileCache]);

	const finishSignIn = useCallback(
		async (step: SignInStep) => {
			if (step.status !== "signedIn") return step;
			const me = await fetchMe();
			if (!me.ok) {
				await tokenStore.clear();
				return { status: "error", reason: "network" } as const;
			}
			await profileCache?.write(ME_CACHE.name, ME_CACHE.schema, me.me);
			setState({ status: "signedIn", me: me.me, offline: false });
			return step;
		},
		[fetchMe, profileCache],
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
			async signOut() {
				await authApi?.signOut();
				await tokenStore.clear();
				await profileCache?.clear();
				await local?.cache.clear();
				setState({ status: "signedOut", expired: false });
			},
		}),
		[state, api, local, authApi, finishSignIn, profileCache],
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
