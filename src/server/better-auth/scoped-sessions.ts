import { APIError } from "better-auth/api";
import { db } from "~/server/db";

const SESSION_COOKIES = [
	"better-auth.session_token",
	"__Secure-better-auth.session_token",
];

/** The session token inside a cookie or bearer value ("<token>[.<sig>]", maybe URL-encoded). */
export function sessionTokenOf(value: string): string {
	let decoded = value;
	try {
		decoded = decodeURIComponent(value);
	} catch {
		// Not URL-encoded; use it as sent.
	}
	return decoded.split(".")[0] ?? "";
}

/**
 * The session token a request names, from `Authorization: Bearer` first
 * (the bearer plugin prefers it) or the session cookie. Unverified: only
 * ever used to refuse a request, never to grant one.
 */
export function requestSessionToken(headers: Headers): string | null {
	const auth = headers.get("authorization");
	if (auth && /^bearer /i.test(auth))
		return sessionTokenOf(auth.slice(7).trim());
	for (const part of (headers.get("cookie") ?? "").split(";")) {
		const [name, ...rest] = part.trim().split("=");
		if (name && SESSION_COOKIES.includes(name))
			return sessionTokenOf(rest.join("="));
	}
	return null;
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
 * - a live scoped session may only read itself, sign out or redeem a
 *   device code;
 * - approving devices and managing API keys needs the web app: no
 *   Authorization header and an unscoped session.
 */
export async function guardScopedSessions(path: string, headers: Headers) {
	if (webOnly(path) && headers.has("authorization")) {
		throw forbidden("Use the web app for this");
	}
	if (
		SCOPED_ALLOWED.includes(path) ||
		SCOPED_ALLOWED_PREFIXES.some((p) => path.startsWith(p))
	) {
		return;
	}
	const token = requestSessionToken(headers);
	if (!token) return;
	const session = await db.session.findUnique({
		where: { token },
		select: { scopes: true, expiresAt: true },
	});
	if (session && session.scopes !== null && session.expiresAt > new Date()) {
		throw forbidden("This token cannot use this endpoint");
	}
}
