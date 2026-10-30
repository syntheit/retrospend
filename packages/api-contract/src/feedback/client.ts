// Dependency-free on purpose: the mobile app imports this file by its own
// subpath (@retrospend/api-contract/feedback-client) so its tests and bundle
// do not load the oRPC contract. The server runs the same functions again on
// everything it receives.

/** A screenshot is re-encoded to WebP on the server; this caps what is sent. */
export const FEEDBACK_SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;

export const ERROR_REPORT_BATCH_MAX = 20;

/**
 * What an error report may carry, and no more: the error name, a message with
 * every number masked and every quoted string, JSON body, address, path,
 * email, token and account number replaced, and stack frames reduced to
 * file:line of the app's own code. Names of people cannot be told from other
 * words, so free text never survives: quotes, JSON and paths are where a name
 * would be.
 */

const TLDS =
	"com|net|org|io|app|dev|co|me|xyz|info|ar|es|br|ru|fr|de|uk|us|test|local|example|invalid|internal|lan|home";

const SCHEME_URL_RE =
	/\b(?:https?|wss?|ftp|file|content|data):\/\/[^\s)'"<>]*/gi;
// host.tld, optionally with a port and a path, no scheme
const BARE_URL_RE = new RegExp(
	`\\b(?:[a-z0-9-]+\\.)+(?:${TLDS})\\b(?::\\d+)?(?:/[^\\s)'"<>]*)?`,
	"gi",
);
const IPV4_RE = /\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// api_key=..., Bearer ..., password: ... (the value, whatever its length)
const SECRET_RE =
	/\b(bearer|basic|token|api[-_ ]?key|apikey|secret|password|passwd|session|cookie)\b(\s*[:=]?\s*)[^\s,;)]+/gi;
// IBAN, with or without spaces
const IBAN_RE = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{3,5}){3,8}\b/g;
// A file system path or a route: /people/alice, C:\Users\x
const PATH_RE = /(?<![\w<])(?:[A-Za-z]:\\|\/)[^\s)'"<>,;]+/g;
// Ids, hashes, keys: a very long run of the token alphabet, or a shorter one
// that mixes letters and digits
const LONG_RUN_RE = /\b[A-Za-z0-9_-]{32,}\b/g;
const MIXED_RE =
	/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{6,}\b/g;
const NUMBER_RE = /\d+(?:[.,]\d+)*/g;

/** /api/v1/expenses/abc becomes /api/expenses/:id; any other path is dropped. */
function routeTemplate(path: string): string {
	const m = /^\/api\/(?:v\d+\/)?([a-z][a-z-]{0,23})(?:\/|$)/.exec(path);
	return m ? `/api/${m[1]}/:id` : "<path>";
}

function stripStructured(text: string): string {
	let out = text;
	// JSON bodies and arrays, innermost first
	for (let i = 0; i < 6; i++) {
		const next = out
			.replace(/\{[^{}]*\}/g, "<json>")
			.replace(/\[[^[\]]*[\w"'][^[\]]*\]/g, "<json>");
		if (next === out) break;
		out = next;
	}
	return out.replace(/"[^"]*"|(?<!\w)'[^']*'|`[^`]*`/g, "<str>");
}

export function scrubErrorText(text: string, max: number): string {
	const out = stripStructured(
		text
			.replace(SCHEME_URL_RE, (u) => {
				const path = /^[a-z]+:\/\/[^/\s]*(\/[^?#\s]*)?/i.exec(u)?.[1] ?? "";
				return path.startsWith("/api/") ? routeTemplate(path) : "<url>";
			})
			.replace(EMAIL_RE, "<email>"),
	)
		.replace(BARE_URL_RE, "<url>")
		.replace(IPV4_RE, "<ip>")
		.replace(SECRET_RE, (_m, word: string) => `${word} <token>`)
		.replace(IBAN_RE, "<account>")
		.replace(PATH_RE, (p) => routeTemplate(p))
		.replace(LONG_RUN_RE, "<id>")
		.replace(MIXED_RE, "<id>")
		.replace(NUMBER_RE, "#");
	return out.length > max ? `${out.slice(0, max - 1)}~` : out;
}

// file.ext:line[:col] with a js-ish extension, the query string left out
const FRAME_RE =
	/([\w.-]+\.(?:js|jsx|ts|tsx|mjs|cjs|hbc|bundle))(?:\?[^\s:)]*)?:(\d+)(?::(\d+))?/;
const MAX_FRAMES = 30;

/**
 * A stack as `at file:line:col` lines of the app's own code. Function names,
 * arguments, addresses and the message line are dropped, and so is anything
 * from node_modules.
 */
export function scrubStack(stack: string, max: number): string {
	const frames: string[] = [];
	for (const line of stack.split("\n")) {
		if (line.includes("node_modules")) continue;
		const m = FRAME_RE.exec(line);
		if (!m) continue;
		frames.push(`at ${m[1]}:${m[2]}${m[3] ? `:${m[3]}` : ""}`);
		if (frames.length >= MAX_FRAMES) break;
	}
	const out = frames.join("\n");
	return out.length > max ? out.slice(0, max) : out;
}

/** A route template without ids or query: /activity/abc123?x=1 becomes /activity/:id. */
export function scrubScreen(route: string): string {
	const path = route.split(/[?#]/)[0] ?? "";
	return path
		.split("/")
		.map((s) => (/\d/.test(s) || s.length > 20 ? ":id" : s))
		.join("/")
		.slice(0, 200);
}

interface ReportLike {
	message: string;
	stack?: string | null;
	screen?: string | null;
}

/** An error report with every free-text field scrubbed. Safe to run twice. */
export function scrubReport<T extends ReportLike>(report: T): T {
	const stack = report.stack ? scrubStack(report.stack, 4000) : "";
	return {
		...report,
		message: scrubErrorText(report.message, 500),
		stack: stack === "" ? undefined : stack,
		screen: report.screen ? scrubScreen(report.screen) : undefined,
	} as T;
}
