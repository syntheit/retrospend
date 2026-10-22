import { auth } from "./config";
import { pluginBearer } from "./scoped-sessions";

/**
 * The web app's session: a cookie session with no scopes. Every non-v1
 * entry point (tRPC, upload and import routes, pages) reads the session
 * through this, so a mobile, device or API token never becomes a full web
 * session there. Those tokens work on /api/v1 only, where scopes apply.
 *
 * A request with a bearer (as the bearer plugin reads it) is never a web
 * session. Other Authorization schemes (Basic from a reverse proxy) are
 * ignored, as the plugin ignores them. So a browser extension that adds an
 * `Authorization: Bearer` header to the app's requests signs the user out
 * of the web app until it stops.
 */
export async function getWebSession(headers: Headers) {
	if (pluginBearer(headers) !== null) return null;
	const session = await auth.api.getSession({ headers });
	if (!session || session.session.scopes != null) return null;
	return session;
}
