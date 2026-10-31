import type { Me } from "@retrospend/api-contract";
import type { ReadCache } from "@/data/cache";
import type { TokenStore } from "./token-store";

// Opening the app with a token on the phone. The server decides whether the
// session still lives; with no connection the cached profile keeps the app
// usable offline (the phone is offline-first, so a train tunnel is not a
// sign-out).

export const ME_CACHE = { name: "me", schema: 1 } as const;

export type Restored =
	| { status: "signedOut"; expired: boolean }
	| {
			status: "signedIn";
			me: Me | null;
			offline: boolean;
			/** When the cached profile was fetched; set while offline. */
			offlineSince: string | null;
	  };

export type FetchMe =
	| { ok: true; me: Me }
	| { ok: false; reason: "unauthorized" | "offline" };

/**
 * The session ended on the server. Whose it was is read from the cached
 * profile before anything here clears it, and `ended` drops that account's
 * data; then the token and the profile go. The restore and the 401 handler
 * can both end the same session at once: each reads the account first, so
 * whichever clears the profile has already handed the account over.
 */
export async function endSession(deps: {
	tokens: TokenStore;
	profileCache: ReadCache;
	ended?: (meId: string | null) => Promise<void>;
	/** The account when the caller knows it. */
	meId?: string | null;
}): Promise<void> {
	const meId =
		deps.meId ??
		(await deps.profileCache.read<Me>(ME_CACHE.name, ME_CACHE.schema))?.data
			.id ??
		null;
	await deps.ended?.(meId);
	await Promise.all([deps.tokens.clear(), deps.profileCache.clear()]);
}

export async function restoreSession(deps: {
	tokens: TokenStore;
	fetchMe: () => Promise<FetchMe>;
	/** One profile per server on this phone, so it is readable offline. */
	profileCache: ReadCache;
	/**
	 * The session ended before the app opened: drop what a sign-out drops
	 * for this server. Gets the account from the cached profile, or null.
	 */
	ended?: (meId: string | null) => Promise<void>;
}): Promise<Restored> {
	if (!(await deps.tokens.get())) {
		return { status: "signedOut", expired: false };
	}
	const result = await deps.fetchMe();
	if (result.ok) {
		await deps.profileCache.write(ME_CACHE.name, ME_CACHE.schema, result.me);
		return {
			status: "signedIn",
			me: result.me,
			offline: false,
			offlineSince: null,
		};
	}
	if (result.reason === "unauthorized") {
		await endSession(deps);
		return { status: "signedOut", expired: true };
	}
	const cached = await deps.profileCache.read<Me>(
		ME_CACHE.name,
		ME_CACHE.schema,
	);
	return {
		status: "signedIn",
		me: cached?.data ?? null,
		offline: true,
		offlineSince: cached?.fetchedAt ?? null,
	};
}

/** How long a cold start with no cached profile waits for the server. */
export const OPEN_TIMEOUT_MS = 4000;

export interface Opening {
	/** What the app shows now. */
	first: Restored;
	/**
	 * What the server says once it answers, or null when `first` already is
	 * that. A session the server ended arrives here as signedOut.
	 */
	settled: Promise<Restored | null>;
}

/**
 * Opening the app. With a token and a cached profile the app opens signed in
 * from the cache at once and the server's answer follows in `settled`; the
 * phone is offline-first, so a slow network is not a reason to wait. With a
 * token and no cache it waits for the server, but only `timeoutMs`; after
 * that it opens offline and the answer still follows.
 */
export async function openSession(
	deps: Parameters<typeof restoreSession>[0] & { timeoutMs?: number },
): Promise<Opening> {
	if (!(await deps.tokens.get())) {
		return {
			first: { status: "signedOut", expired: false },
			settled: Promise.resolve(null),
		};
	}
	const cached = await deps.profileCache.read<Me>(
		ME_CACHE.name,
		ME_CACHE.schema,
	);
	// Nobody waits on the check once the app is open; a failure is no answer.
	const check = restoreSession(deps);
	const later = check.catch((): Restored | null => null);
	if (cached) {
		return {
			first: {
				status: "signedIn",
				me: cached.data,
				offline: false,
				offlineSince: null,
			},
			settled: later,
		};
	}
	let timer: ReturnType<typeof setTimeout> | undefined;
	const early = await Promise.race([
		check,
		new Promise<null>((resolve) => {
			timer = setTimeout(
				() => resolve(null),
				deps.timeoutMs ?? OPEN_TIMEOUT_MS,
			);
		}),
	]);
	clearTimeout(timer);
	if (early) return { first: early, settled: Promise.resolve(null) };
	return {
		first: { status: "signedIn", me: null, offline: true, offlineSince: null },
		settled: later,
	};
}
