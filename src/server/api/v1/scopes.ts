import {
	MOBILE_SCOPES,
	parseScopeList,
	type RouteScope,
	SCOPES,
	type Scope,
} from "@retrospend/api-contract/common";

/** How the caller authenticated. */
export type PrincipalKind = "cookie" | "bearer" | "device" | "apiKey";

/**
 * Client ids allowed to start device authorization (RFC 8628). The later
 * CLI, desktop (libadwaita) and MCP clients use these; an unknown id is
 * `invalid_client`.
 */
export const DEVICE_CLIENT_IDS: readonly string[] = [
	"retrospend-cli",
	"retrospend-desktop",
	"retrospend-mcp",
];

/** What a device or API key gets when it asks for nothing. */
export const DEFAULT_TOKEN_SCOPES: readonly Scope[] = ["read"];

/** Space-separated, as stored on session.scopes and sent by OAuth clients. */
export function formatScopeList(scopes: readonly Scope[]): string {
	return scopes.join(" ");
}

/**
 * Scopes of an API key from its plugin `permissions` ({"scopes": [...]}).
 * Anything unknown is dropped, so a hand-edited row cannot grant more.
 */
export function apiKeyScopes(
	permissions: Record<string, string[]> | null | undefined,
): Scope[] {
	return parseScopeList((permissions?.scopes ?? []).join(" ")).scopes;
}

/**
 * The scopes a principal can use on this request.
 * - A session with stored scopes (device authorization) gets exactly those,
 *   whatever transport carries it, so a device token sent as a cookie gains
 *   nothing.
 * - Other sessions are full password sign-ins: a cookie gets every scope,
 *   a bearer token (mobile) every scope but admin.
 * - An API key gets its stored scopes.
 * `admin` is dropped unless the user has the admin role today, so a token
 * minted while an admin keeps no admin power after a demotion.
 */
export function effectiveScopes(input: {
	kind: PrincipalKind;
	granted: readonly Scope[] | null;
	role: string;
}): Scope[] {
	const base =
		input.granted ??
		(input.kind === "cookie"
			? SCOPES
			: input.kind === "bearer"
				? MOBILE_SCOPES
				: []);
	return base.filter((s) => s !== "admin" || input.role === "ADMIN");
}

/** `public` needs nothing; any other route needs its scope. */
export function hasScope(scopes: readonly Scope[], required: RouteScope) {
	return required === "public" || scopes.includes(required);
}
