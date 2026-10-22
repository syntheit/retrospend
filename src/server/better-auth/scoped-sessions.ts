import { APIError } from "better-auth/api";
import { parseCookies } from "better-call";
import { db } from "~/server/db";

/**
 * Every token here is derived the way better-auth itself derives it, so the
 * guard and getSession always agree on which session a request names:
 * - cookies through better-call's parseCookies, the parser getSession's
 *   getSignedCookie uses (trims, strips quotes, keeps the first of a name);
 * - the bearer through the bearer plugin's own checks
 *   (src/plugins/bearer in better-auth 1.7.12).
 */

const SESSION_TOKEN_COOKIES = [
	"better-auth.session_token",
	"__Secure-better-auth.session_token",
];
const SESSION_COOKIES = [
	...SESSION_TOKEN_COOKIES,
	"better-auth.session_data",
	"__Secure-better-auth.session_data",
];

function tryDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

/** The session token inside a signed value "<token>.<signature>". */
export function sessionTokenOf(value: string): string {
	return value.split(".")[0] ?? "";
}

/**
 * The bearer value the bearer plugin acts on, or null where it ignores the
 * header: only "bearer " (one space, any case) followed by a non-empty
 * token. Any other scheme, `Bearer\t...` included, leaves the cookie in
 * charge, for the plugin and for us.
 */
export function pluginBearer(headers: Headers): string | null {
	const header = headers.get("authorization");
	if (!header || header.slice(0, 7).toLowerCase() !== "bearer ") return null;
	return header.slice(7).trim() || null;
}

/** The session token a bearer value names, as the plugin decodes it. */
export function bearerSessionToken(bearer: string): string {
	if (!bearer.includes(".")) return bearer;
	return sessionTokenOf(bearer.includes("%") ? tryDecode(bearer) : bearer);
}

/** Session tokens in the cookies, read with getSession's own parser. */
function cookieSessionTokens(cookieName: string, headers: Headers): string[] {
	const cookies = parseCookies(headers.get("cookie") ?? "");
	return [...new Set([cookieName, ...SESSION_TOKEN_COOKIES])]
		.map((name) => cookies.get(name))
		.filter((v): v is string => !!v)
		.map(sessionTokenOf);
}

/**
 * The request without session cookies, re-serialized the way the bearer
 * plugin's setRequestCookie writes them, so with a bearer only the bearer
 * can name a session.
 */
function withoutSessionCookies(cookieName: string, headers: Headers): Headers {
	const next = new Headers(headers);
	const drop = new Set([cookieName, ...SESSION_COOKIES]);
	const kept = [...parseCookies(headers.get("cookie") ?? "")]
		.filter(([name]) => !drop.has(name))
		.map(([name, value]) => `${name}=${encodeURIComponent(value)}`);
	if (kept.length > 0) next.set("cookie", kept.join("; "));
	else next.delete("cookie");
	return next;
}

/** Auth endpoints a scoped (mobile or device) session may still call. */
const SCOPED_ALLOWED = ["/get-session", "/sign-out", "/device/token"];
/** Sign-in and sign-up do not act on the current session, so a stale token never blocks them. */
const SCOPED_ALLOWED_PREFIXES = ["/sign-in/", "/sign-up/"];

/** Endpoints only a person in the web app may call. */
function webOnly(path: string): boolean {
	return (
		path === "/device/approve" ||
		path === "/device/deny" ||
		path.startsWith("/api-key/")
	);
}

const forbidden = (message: string) => new APIError("FORBIDDEN", { message });

/**
 * Keeps scoped tokens inside their scopes on the auth endpoints (the bearer
 * plugin turns any token into a session for every endpoint):
 * - if the bearer or a session cookie names a live scoped session, only
 *   reading the session, signing out and redeeming a device code are open.
 *   Both are checked, so whichever one better-auth ends up using is covered;
 * - with a bearer the plugin acts on, the session cookies are dropped, so
 *   a bearer it rejects never falls back to a cookie;
 * - approving devices and managing API keys needs the web app: no bearer
 *   and an unscoped session.
 * Returns the headers the endpoint should see when they changed.
 */
export async function guardScopedSessions(
	path: string,
	headers: Headers,
	cookieName: string,
): Promise<Headers | null> {
	const bearer = pluginBearer(headers);
	if (bearer !== null && webOnly(path)) {
		throw forbidden("Use the web app for this");
	}
	const open =
		SCOPED_ALLOWED.includes(path) ||
		SCOPED_ALLOWED_PREFIXES.some((p) => path.startsWith(p));
	const tokens = [
		...(bearer === null ? [] : [bearerSessionToken(bearer)]),
		...cookieSessionTokens(cookieName, headers),
	].filter(Boolean);
	if (!open && tokens.length > 0) {
		const scoped = await db.session.findFirst({
			where: {
				token: { in: tokens },
				scopes: { not: null },
				expiresAt: { gt: new Date() },
			},
			select: { id: true },
		});
		if (scoped) throw forbidden("This token cannot use this endpoint");
	}
	return bearer === null ? null : withoutSessionCookies(cookieName, headers);
}
