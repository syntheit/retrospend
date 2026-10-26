/**
 * Cross-site request forgery guard for cookie sessions. A browser attaches
 * the web session cookie to any request to this origin, so a write that came
 * from another site must not run as the signed-in person. Bearer, API key
 * and device credentials are never attached by the browser on their own and
 * are not checked here.
 *
 * Refused: a write whose `Sec-Fetch-Site` says cross-site or same-site (a
 * sibling subdomain is not the app), or whose `Origin` names another origin.
 * Requests with neither header (curl, server-side calls, tests) pass: only a
 * browser sends them, and a browser always sends at least one.
 */
export function isCrossSiteWrite(
	headers: Headers,
	appOrigin: string | null,
): boolean {
	const site = headers.get("sec-fetch-site");
	if (site === "cross-site" || site === "same-site") return true;
	const origin = headers.get("origin");
	if (!origin) return false;
	if (origin === "null") return true;
	let parsed: URL;
	try {
		parsed = new URL(origin);
	} catch {
		return true;
	}
	if (appOrigin && parsed.origin === appOrigin) return false;
	// Behind a proxy the configured URL may be missing: the Host the browser
	// asked for is the same origin by definition (a page on another site
	// cannot choose the Host of its request).
	const host = headers.get("host");
	return !(host && parsed.host === host);
}

/** The app's own origin from the configured public URL, or null when unset. */
export function appOriginFrom(url: string | undefined): string | null {
	if (!url) return null;
	try {
		return new URL(url).origin;
	} catch {
		return null;
	}
}
