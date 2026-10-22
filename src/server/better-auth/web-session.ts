import { auth } from "./config";

/**
 * The web app's session: a cookie session with no scopes. Every non-v1
 * entry point (tRPC, upload and import routes, pages) reads the session
 * through this, so a mobile, device or API token never becomes a full web
 * session there. Those tokens work on /api/v1 only, where scopes apply.
 */
export async function getWebSession(headers: Headers) {
	if (headers.has("authorization")) return null;
	const session = await auth.api.getSession({ headers });
	if (!session || session.session.scopes != null) return null;
	return session;
}
