import {
	MOBILE_SCOPES,
	parseScopeList,
	type RouteScope,
	SCOPES,
	type Scope,
} from "@retrospend/api-contract/common";

/**
 * What kind of credential the caller holds. It comes from the session row,
 * not from the transport: a mobile or device token sent as a cookie is
 * still that token, with its stored scopes.
 */
export type PrincipalKind = "web" | "mobile" | "device" | "apiKey";

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

/** The client id stamped on sessions the Expo app signs in. */
export const MOBILE_CLIENT_ID = "retrospend-mobile";

/** The Expo app's deep-link scheme, also its Origin. */
export const MOBILE_ORIGIN = "retrospend://";

/** What a device or API key gets when it asks for nothing. */
export const DEFAULT_TOKEN_SCOPES: readonly Scope[] = ["read"];

/** session.scopes is VARCHAR(255); a longer request is refused, never truncated. */
export const MAX_SCOPE_LIST_LENGTH = 255;

/** Space-separated, as stored on session.scopes and sent by OAuth clients. */
export function formatScopeList(scopes: readonly Scope[]): string {
	return scopes.join(" ");
}

/**
 * Whether a request comes from the Expo app: its client sends
 * `expo-origin`, and the expo plugin copies that into Origin.
 */
export function isMobileAppRequest(headers: Headers | undefined): boolean {
	if (!headers) return false;
	return (
		headers.has("expo-origin") ||
		(headers.get("origin") ?? "").startsWith(MOBILE_ORIGIN)
	);
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
 * The kind of a session from its stamped client id. Mobile and device
 * sessions are stamped when they are made; an unstamped session is the web
 * app's and only ever valid as its cookie.
 */
export function sessionKind(
	clientId: string | null,
): Exclude<PrincipalKind, "apiKey"> {
	if (clientId === MOBILE_CLIENT_ID) return "mobile";
	if (clientId) return "device";
	return "web";
}

/**
 * The scopes a principal can use on this request.
 * - Stored scopes (mobile, device, API key) win, whatever the transport.
 * - An unscoped web session gets every scope; an unscoped mobile one
 *   everything but admin; anything else nothing.
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
		(input.kind === "web"
			? SCOPES
			: input.kind === "mobile"
				? MOBILE_SCOPES
				: []);
	return base.filter((s) => s !== "admin" || input.role === "ADMIN");
}

/**
 * What a device may get when this user approves it: the scopes it asked
 * for (read when it asked for none), never more than the approver's own
 * web session could use.
 */
export function capDeviceScopes(requested: string | undefined, role: string) {
	const asked = parseScopeList(requested).scopes;
	const allowed = effectiveScopes({ kind: "web", granted: null, role });
	const capped = (asked.length > 0 ? asked : DEFAULT_TOKEN_SCOPES).filter((s) =>
		allowed.includes(s),
	);
	return capped.length > 0 ? capped : [...DEFAULT_TOKEN_SCOPES];
}

/** `public` needs nothing; any other route needs its scope. */
export function hasScope(scopes: readonly Scope[], required: RouteScope) {
	return required === "public" || scopes.includes(required);
}
