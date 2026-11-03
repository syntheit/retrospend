// The test-only sign-in link, `retrospend://__e2e/session?server=&email=&password=&route=`,
// parsed and checked. Only src/dev/E2eLink.tsx imports this, and that is only
// required in the e2e build profile, so none of it is in a release bundle.

/**
 * The servers a test build may sign in to. A link names the server, so
 * without this list anyone who can open a URL on the device could point an
 * e2e build at their own server. Loopback (the iOS simulator through its
 * ssh forward, an adb reverse) and the Android emulator's alias for the host.
 */
export const E2E_SERVER_HOSTS = ["localhost", "127.0.0.1", "10.0.2.2"];

export interface E2eSession {
	/** Normalized: lowercase, no path. */
	server: string;
	email: string;
	password: string;
	/** An in-app path to open after sign-in, or null. */
	route: string | null;
}

const LINK = "retrospend://__e2e/session?";
const HOSTS = E2E_SERVER_HOSTS.map((host) => host.replace(/\./g, "\\."));
// Matched as a whole string, not parsed: a lookalike such as
// http://localhost@evil.example or http://localhost.evil.example fails it.
const SERVER = new RegExp(
	`^(https?)://(${HOSTS.join("|")})(:\\d{1,5})?/?$`,
	"i",
);
// An in-app path only: starts with one slash, no scheme, no "..".
const ROUTE = /^\/(?!\/)[\w\-/()[\]%.=&?]*$/;

/** The session a test link carries, or null when it is not one or is not allowed. */
export function parseE2eLink(url: string): E2eSession | null {
	if (!url.startsWith(LINK)) return null;
	const params = new Map<string, string>();
	try {
		for (const pair of url.slice(LINK.length).split("&")) {
			const at = pair.indexOf("=");
			if (at < 1) continue;
			const key = decodeURIComponent(pair.slice(0, at));
			if (!params.has(key)) {
				params.set(key, decodeURIComponent(pair.slice(at + 1)));
			}
		}
	} catch {
		return null;
	}
	const match = SERVER.exec(params.get("server") ?? "");
	const email = params.get("email");
	const password = params.get("password");
	const [, scheme, host, port = ""] = match ?? [];
	if (!scheme || !host || !email || !password) return null;
	const route = params.get("route") ?? "";
	if (route && (!ROUTE.test(route) || route.includes(".."))) return null;
	return {
		server: `${scheme.toLowerCase()}://${host.toLowerCase()}${port}`,
		email,
		password,
		route: route || null,
	};
}
