import { createHmac, timingSafeEqual } from "node:crypto";
import { APIError } from "better-auth/api";
import { db } from "~/server/db";

const SESSION_COOKIE = /^(__Secure-)?better-auth\.session_(token|data)$/;
const SESSION_TOKEN_COOKIE = /^(__Secure-)?better-auth\.session_token$/;

function tryDecode(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

/** The session token inside a cookie or bearer value ("<token>[.<sig>]", maybe URL-encoded). */
export function sessionTokenOf(value: string): string {
	return tryDecode(value).split(".")[0] ?? "";
}

function cookieParts(headers: Headers): { name: string; value: string }[] {
	return (headers.get("cookie") ?? "")
		.split(";")
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part) => {
			const [name = "", ...rest] = part.split("=");
			return { name, value: rest.join("=") };
		});
}

/** Every session token the cookies name (a client may send several). */
function cookieTokens(headers: Headers): string[] {
	return cookieParts(headers)
		.filter((c) => SESSION_TOKEN_COOKIE.test(c.name))
		.map((c) => sessionTokenOf(c.value));
}

/** Base64 or base64url, padded or not: the forms a cookie signature arrives in. */
const normalize = (sig: string) =>
	sig.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");

/** HMAC-SHA256 check of "<token>.<signature>", as the bearer plugin does it. */
function signatureMatches(token: string, signature: string, secret: string) {
	const expected = Buffer.from(
		normalize(createHmac("sha256", secret).update(token).digest("base64")),
	);
	const given = Buffer.from(normalize(signature));
	return expected.length === given.length && timingSafeEqual(expected, given);
}

const unauthorized = (message: string) =>
	new APIError("UNAUTHORIZED", { message });
const forbidden = (message: string) => new APIError("FORBIDDEN", { message });

/**
 * The session token in the Authorization header, or null without one.
 * Anything the bearer plugin would ignore (another scheme, a bad
 * signature, a malformed value) is refused here, because the plugin then
 * falls back to the cookie and the request would run as that session.
 */
function bearerTokenOf(headers: Headers, secret: string): string | null {
	const header = headers.get("authorization");
	if (header === null) return null;
	const match = /^bearer\s+(\S+)$/i.exec(header.trim());
	if (!match?.[1]) throw unauthorized("Unsupported Authorization header");
	const value = tryDecode(match[1]);
	if (!value.includes(".")) return value;
	const [token, signature, ...rest] = value.split(".");
	if (!token || !signature || rest.length > 0)
		throw unauthorized("Malformed bearer token");
	if (!signatureMatches(token, signature, secret))
		throw unauthorized("Invalid bearer token");
	return token;
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

/** The request without session cookies, so only the bearer can name a session. */
function withoutSessionCookies(headers: Headers): Headers {
	const next = new Headers(headers);
	const kept = cookieParts(headers)
		.filter((c) => !SESSION_COOKIE.test(c.name))
		.map((c) => `${c.name}=${c.value}`);
	if (kept.length > 0) next.set("cookie", kept.join("; "));
	else next.delete("cookie");
	return next;
}

/**
 * Keeps scoped tokens inside their scopes on the auth endpoints (the bearer
 * plugin turns any token into a session for every endpoint):
 * - an Authorization header must be a bearer the plugin accepts, and it
 *   replaces the session cookies, so a bad bearer never falls back to them;
 * - if the bearer or any session cookie names a live scoped session, only
 *   reading the session, signing out and redeeming a device code are open;
 * - approving devices and managing API keys needs the web app: no
 *   Authorization header and an unscoped session.
 * Returns the headers the endpoint should see when they changed.
 */
export async function guardScopedSessions(
	path: string,
	headers: Headers,
	secret: string,
): Promise<Headers | null> {
	const bearer = bearerTokenOf(headers, secret);
	if (bearer !== null && webOnly(path)) {
		throw forbidden("Use the web app for this");
	}
	const open =
		SCOPED_ALLOWED.includes(path) ||
		SCOPED_ALLOWED_PREFIXES.some((p) => path.startsWith(p));
	const tokens = [bearer, ...cookieTokens(headers)].filter(
		(t): t is string => !!t,
	);
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
	return bearer === null ? null : withoutSessionCookies(headers);
}
