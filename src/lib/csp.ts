/**
 * The Content-Security-Policy for pages. Scripts run only with this request's
 * nonce (and the scripts those load, 'strict-dynamic'), so a script injected
 * into the page does not run. Styles stay 'unsafe-inline' because React style
 * props and next/font need it and CSS cannot run code.
 *
 * Trusted Types is sent as a separate report-only policy first: the
 * browser console shows what would break, and nothing does. Enforce it once a
 * pass over every screen shows no violation.
 */

/** A fresh, unguessable value for one request. */
export function newNonce(): string {
	return btoa(crypto.randomUUID());
}

export function buildCsp(nonce: string, dev: boolean): string {
	return [
		"default-src 'self'",
		// React uses eval in development for stack traces; never in production.
		`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"font-src 'self'",
		"connect-src 'self'",
		"object-src 'none'",
		"frame-ancestors 'none'",
		"base-uri 'self'",
		"form-action 'self'",
	].join("; ");
}

/** Report-only: logs a console violation where a string reaches an HTML or script sink. */
export const TRUSTED_TYPES_REPORT_ONLY =
	"require-trusted-types-for 'script'; trusted-types nextjs nextjs#bundler default";
