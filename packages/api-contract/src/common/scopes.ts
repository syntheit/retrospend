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

/** What mobile sign-in asks for: everything except `admin`. */
export const MOBILE_SCOPES: readonly Scope[] = SCOPES.filter(
	(s) => s !== "admin",
);

/**
 * What a route needs. `public` routes skip authentication, the apiV1 flag
 * and the scope check; only `GET /server-info` is public today.
 */
export type RouteScope = Scope | "public";

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
