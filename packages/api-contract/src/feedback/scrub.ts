/**
 * Error reports leave the phone only after this pass, and the server runs it
 * again on what it receives. It removes what could name a person or a sum:
 * addresses, emails, bearer tokens, long opaque strings and amounts. Line and
 * column numbers in a stack survive, so a trace stays readable.
 */

const URL_RE = /\b(?:https?|wss?|file):\/\/[^\s)'"<>]*/gi;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BEARER_RE = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
// Ids, hashes and keys: 24 or more characters from the token alphabet.
const OPAQUE_RE = /\b[A-Za-z0-9_-]{24,}\b/g;
// 1,234.56 / 1.234,56 / 12.5 / $12 / EUR 12
const AMOUNT_RE =
	/(?:[$€£¥]\s?\d[\d.,]*|\b\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d+)?\b|\b\d+[.,]\d{1,2}\b)/g;

function trimTrailing(url: string): string {
	// Keep a trailing :line:col so a stack frame stays useful.
	const m = /(:\d+){1,2}$/.exec(url);
	return m ? m[0] : "";
}

export function scrubErrorText(text: string, max: number): string {
	const out = text
		.replace(URL_RE, (u) => `<url>${trimTrailing(u)}`)
		.replace(EMAIL_RE, "<email>")
		.replace(BEARER_RE, (_m, scheme: string) => `${scheme} <token>`)
		.replace(OPAQUE_RE, "<id>")
		.replace(AMOUNT_RE, "<n>");
	return out.length > max ? `${out.slice(0, max - 1)}~` : out;
}

/** A route without ids or query: /activity/abc123?x=1 becomes /activity/:id. */
export function scrubScreen(route: string): string {
	const path = route.split(/[?#]/)[0] ?? "";
	return path
		.split("/")
		.map((s) => (/\d/.test(s) || s.length > 20 ? ":id" : s))
		.join("/")
		.slice(0, 200);
}
