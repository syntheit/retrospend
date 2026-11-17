/**
 * The policy a worker's own script response carries. The browser applies the
 * CSP of the response a worker was loaded from, not the page's, and
 * /_next/static is outside the proxy matcher, so nothing else sets one. The
 * worker may run its own and same-origin scripts and call the same origin
 * (the sync routes) and nothing else. Turbopack serves a worker's entry and
 * chunks as ordinary chunks (it has no per-file target), so next.config
 * sends this on every /_next/static/chunks file: a CSP on a response that is
 * neither a document nor a worker is ignored, so it costs the page nothing.
 */
export const WORKER_CSP =
	"default-src 'none'; script-src 'self'; connect-src 'self'";
