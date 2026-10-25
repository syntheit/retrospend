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

export async function restoreSession(deps: {
	tokens: TokenStore;
	fetchMe: () => Promise<FetchMe>;
	/** One profile per server on this phone, so it is readable offline. */
	profileCache: ReadCache;
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
		await deps.tokens.clear();
		await deps.profileCache.clear();
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
