import * as z from "zod";

/**
 * Token scopes (IMPLEMENTATION §2.3). Every token type carries a subset:
 * - `read`: every GET.
 * - `write:expenses`: expenses, recurring, categories, imports.
 * - `write:money`: payments, transfers, income, budget moves.
 * - `write:settings`: settings, profile, tokens, webhooks, push devices.
 * - `admin`: admin routes; only ever effective for a user with the admin role.
 */
export const SCOPES = [
	"read",
	"write:expenses",
	"write:money",
	"write:settings",
	"admin",
] as const;

export type Scope = (typeof SCOPES)[number];

export const scopeSchema = z.enum(SCOPES).meta({
	id: "Scope",
	description: "A permission a token carries.",
});

/**
 * What mobile sign-in asks for: every scope. `admin` is stamped on every
 * mobile session but is only effective while the user has the admin role,
 * so a plain user's phone never holds it and a demoted admin loses it.
 */
export const MOBILE_SCOPES: readonly Scope[] = SCOPES;

/**
 * Client ids allowed to start device authorization (RFC 8628). The later
 * CLI, desktop (libadwaita) and MCP clients use these; an unknown id is
 * `invalid_client`. Sessions they sign in carry the id, so Settings lists
 * them as approved devices.
 */
export const DEVICE_CLIENT_IDS: readonly string[] = [
	"retrospend-cli",
	"retrospend-desktop",
	"retrospend-mcp",
];

/**
 * Scopes that only a signed-in web or mobile session holds. They are not in
 * SCOPES on purpose: no personal access token, API key or device session can
 * be given one (parseScopeList does not know them), so the token sheet, the
 * device approval and `GET /me` never list them.
 * - `account:delete`: delete the signed-in user's own account.
 * - `account:security`: change the password, list the signed-in sessions
 *   and sign one of them out.
 * - `sync`: the raw row pulls under `/sync` (E2EE lane P). Only the Expo
 *   app's session holds it; the web app and every token do not.
 */
export const SESSION_SCOPES = [
	"account:delete",
	"account:security",
	"sync",
] as const;

export type SessionScope = (typeof SESSION_SCOPES)[number];

/**
 * What a route needs. `public` routes skip authentication, the apiV1 flag
 * and the scope check; only `GET /server-info` is public today.
 */
export type RouteScope = Scope | SessionScope | "public";

export function isSessionScope(value: string): value is SessionScope {
	return (SESSION_SCOPES as readonly string[]).includes(value);
}

export function isScope(value: string): value is Scope {
	return (SCOPES as readonly string[]).includes(value);
}

/**
 * Parses a space-separated scope string (RFC 8628 / OAuth style). Unknown
 * scopes are returned separately so callers can reject them.
 */
export function parseScopeList(raw: string | null | undefined): {
	scopes: Scope[];
	unknown: string[];
} {
	const scopes: Scope[] = [];
	const unknown: string[] = [];
	for (const part of (raw ?? "").split(/\s+/)) {
		if (!part) continue;
		if (isScope(part)) {
			if (!scopes.includes(part)) scopes.push(part);
		} else unknown.push(part);
	}
	return { scopes, unknown };
}
