import { parseScopeList, type Scope } from "@retrospend/api-contract/common";
import type { PrincipalKind } from "~/server/api/v1/scopes";
import {
	apiKeyScopes,
	effectiveScopes,
	sessionKind,
} from "~/server/api/v1/scopes";
import { auth } from "~/server/better-auth";
import { sessionTokenOf } from "~/server/better-auth/scoped-sessions";
import { db } from "~/server/db";

/** Prefix of every key the api-key plugin issues (config.ts). */
export const API_KEY_PREFIX = "rsk_";

/** The one caller a v1 request runs as. */
export type Principal = {
	kind: PrincipalKind;
	userId: string;
	role: string;
	scopes: Scope[];
	/** Session id or API key id: the rate limit and audit key. */
	tokenId: string;
	expiresAt: Date | null;
	clientId: string | null;
};

export type PrincipalResult =
	| { ok: true; principal: Principal }
	| { ok: false; reason: "none" | "invalid" };

function bearerToken(headers: Headers): string | null {
	const value = headers.get("authorization");
	if (!value || !/^bearer /i.test(value)) return null;
	return value.slice(7).trim() || null;
}

/** An API key comes in `x-api-key` or as a bearer token with our prefix. */
function apiKeyFrom(headers: Headers): string | null {
	const header = headers.get("x-api-key")?.trim();
	if (header) return header;
	const bearer = bearerToken(headers);
	return bearer?.startsWith(API_KEY_PREFIX) ? bearer : null;
}

async function fromApiKey(key: string): Promise<PrincipalResult> {
	const result = await auth.api.verifyApiKey({ body: { key } });
	if (!result.valid || !result.key) return { ok: false, reason: "invalid" };
	const user = await db.user.findUnique({
		where: { id: result.key.referenceId },
		select: { id: true, role: true, isActive: true },
	});
	if (!user?.isActive) return { ok: false, reason: "invalid" };
	return {
		ok: true,
		principal: {
			kind: "apiKey",
			userId: user.id,
			role: user.role,
			scopes: effectiveScopes({
				kind: "apiKey",
				granted: apiKeyScopes(result.key.permissions),
				role: user.role,
			}),
			tokenId: result.key.id,
			expiresAt: result.key.expiresAt ? new Date(result.key.expiresAt) : null,
			clientId: null,
		},
	};
}

/**
 * Resolves the caller from an API key, then a session token sent as a
 * bearer or a cookie (web, mobile or device authorization). Sent but
 * unusable credentials are `invalid` (401), never a fall back to another
 * credential on the same request.
 */
export async function resolvePrincipal(
	headers: Headers,
): Promise<PrincipalResult> {
	const key = apiKeyFrom(headers);
	if (key) return fromApiKey(key);

	const bearer = bearerToken(headers);
	const hasBearer = bearer !== null;
	const session = await auth.api.getSession({ headers });
	if (!session) return { ok: false, reason: hasBearer ? "invalid" : "none" };
	if (!session.user.isActive) return { ok: false, reason: "invalid" };
	// The bearer plugin ignores a token it cannot verify and leaves the
	// cookie in place; the session must be the one the bearer token names.
	// A signed token is "<token>.<signature>", maybe URL-encoded.
	if (bearer && sessionTokenOf(bearer) !== session.session.token)
		return { ok: false, reason: "invalid" };

	const stored = session.session.scopes ?? null;
	const clientId = session.session.clientId ?? null;
	const kind = sessionKind(clientId, hasBearer);
	return {
		ok: true,
		principal: {
			kind,
			userId: session.user.id,
			role: session.user.role,
			scopes: effectiveScopes({
				kind,
				granted: stored === null ? null : parseScopeList(stored).scopes,
				role: session.user.role,
			}),
			tokenId: session.session.id,
			expiresAt: new Date(session.session.expiresAt),
			clientId,
		},
	};
}
