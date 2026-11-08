// Log hygiene scanner (AGENTS.md 6.4: never log personal data, tokens or
// amounts with names). Pure functions over source text; the test walks the
// repo and applies baseline.json. Rules:
//
//   LOG-010  a log call (console.*, logger.*, Go log.* and fmt.Print*) whose
//            arguments name a money or user-text field (title, notes, name,
//            amount, balance, token, email, ...) or a whole record.
//   LOG-020  an event written with a metadata key outside
//            EVENT_METADATA_KEYS (logEvent, logEventAsync, eventLog.create).
//
// Limits: a lexical scan, not a type check. LOG-010 is a denylist of words in
// the identifiers of the arguments (camelCase and snake_case are split), so
// it cannot see what a variable named `x` holds, and an error object passed
// whole is allowed (its message is the caller's to keep clean). Text inside
// string literals is ignored; only `${...}` interpolations and arguments count.
// LOG-020 is an allowlist, so it is exact for object literals and flags
// spreads and non-literal metadata because their keys cannot be checked.

export type Lang = "ts" | "go";

export type LogHit = {
	rule: "LOG-010" | "LOG-020";
	line: number;
	/** The call's arguments, trimmed to one short line. */
	match: string;
	/** Why: the sensitive words, or the metadata keys, that triggered it. */
	why: string;
};

export const RULES: Record<string, string> = {
	"LOG-010":
		"a log call names a money or user-text field, a token or a whole record; log an id, a code or a count instead",
	"LOG-020":
		"an event has a metadata key outside EVENT_METADATA_KEYS (src/server/services/api-v1/event-metadata-keys.ts); use ids, flags and counts, or add the key only after checking it holds no user text",
};

/** Words (after splitting camelCase and snake_case) that mark money or user text. */
export const SENSITIVE_WORDS: ReadonlySet<string> = new Set([
	// user text
	"title",
	"description",
	"desc",
	"note",
	"notes",
	"name",
	"names",
	"memo",
	"comment",
	"comments",
	"merchant",
	"payee",
	"text",
	"body",
	"content",
	"buffer",
	// money
	"amount",
	"amounts",
	"balance",
	"balances",
	// identity and secrets
	"email",
	"phone",
	"password",
	"passcode",
	"secret",
	"token",
	"cookie",
	"bearer",
	"credential",
	"credentials",
	"authorization",
	"iban",
	// whole records
	"expense",
	"expenses",
	"transaction",
	"transactions",
	"payload",
	"input",
]);

/** Compound names the word split cannot see. */
const SENSITIVE_COMPOUND = /apikey|privatekey|secretkey|passw/i;

/** Go: the name an uploader gave a multipart file (`header.Filename`). */
const UPLOADED_FILE_NAME = "Filename";

/** `err.name` and friends are the error's class, not a user's name. */
const ERROR_NAME = /\b(?:err|error|e|cause|ex)\??\.name\b/g;

/** Schema and code names, not names a user typed. */
const NOT_USER_TEXT =
	/\b(?:modelName|typeName|className|tableName|columnName|fieldName|eventName)\b/g;

/** Counts of things are fine: `len(transactions)`, `rows.length`. */
const COUNT_OF = /\blen\([^()]*\)|[\w$.?]+\.(?:length|size)\b/g;

/** Go's `entry.Name()` on a directory entry is a file name on the server. */
const GO_FILE_NAME = /\.Name\(\)/g;

const IDENT = /[A-Za-z_$][A-Za-z0-9_$]*/g;

export function words(ident: string): string[] {
	return ident
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
		.split(/[\s_$]+/)
		.filter(Boolean)
		.map((w) => w.toLowerCase());
}

/** The sensitive words found in the identifiers of a stretch of code. */
export function sensitiveIn(code: string): string[] {
	const found = new Set<string>();
	const plain = code
		.replace(ERROR_NAME, " ")
		.replace(NOT_USER_TEXT, " ")
		.replace(COUNT_OF, " ")
		.replace(GO_FILE_NAME, " ");
	for (const ident of plain.match(IDENT) ?? []) {
		for (const w of words(ident)) if (SENSITIVE_WORDS.has(w)) found.add(w);
		if (SENSITIVE_COMPOUND.test(ident)) found.add(ident.toLowerCase());
		if (ident === UPLOADED_FILE_NAME) found.add("filename");
	}
	return [...found].sort();
}

// ---- reading a call's arguments ----

type Read = { raw: string; code: string; end: number };

/**
 * Read from just after an opening bracket to its match. `raw` is the source
 * text; `code` is the same with comments and the text of string literals
 * removed and `${...}` interpolations kept, so only expressions remain.
 */
export function readBalanced(
	src: string,
	start: number,
	open: string,
	close: string,
	lang: Lang,
): Read {
	let depth = 1;
	let code = "";
	let i = start;
	while (i < src.length) {
		const c = src[i] as string;
		const next = src[i + 1];
		if (c === "/" && next === "/") {
			while (i < src.length && src[i] !== "\n") i++;
			continue;
		}
		if (c === "/" && next === "*") {
			const e = src.indexOf("*/", i + 2);
			i = e < 0 ? src.length : e + 2;
			continue;
		}
		if (c === '"' || (c === "'" && lang === "ts")) {
			i = skipQuoted(src, i, c);
			code += ' "" ';
			continue;
		}
		if (c === "'" && lang === "go") {
			i = skipQuoted(src, i, c);
			code += " 0 ";
			continue;
		}
		if (c === "`") {
			if (lang === "go") {
				const e = src.indexOf("`", i + 1);
				i = e < 0 ? src.length : e + 1;
				code += ' "" ';
				continue;
			}
			i++;
			while (i < src.length && src[i] !== "`") {
				if (src[i] === "\\") i += 2;
				else if (src[i] === "$" && src[i + 1] === "{") {
					const inner = readBalanced(src, i + 2, "{", "}", lang);
					code += ` ${inner.code} `;
					i = inner.end;
				} else i++;
			}
			i++;
			code += ' "" ';
			continue;
		}
		if (c === open) depth++;
		else if (c === close) {
			depth--;
			if (depth === 0) return { raw: src.slice(start, i), code, end: i + 1 };
		}
		code += c;
		i++;
	}
	return { raw: src.slice(start), code, end: src.length };
}

function skipQuoted(src: string, at: number, quote: string): number {
	let i = at + 1;
	while (i < src.length && src[i] !== quote) {
		if (src[i] === "\\") i++;
		if (src[i] === "\n") break;
		i++;
	}
	return i + 1;
}

// ---- finding calls ----

const TS_LOG =
	/(?<![\w$.])(?:console\.(?:log|info|warn|error|debug|trace)|(?:logger|log)\.(?:log|info|warn|error|debug|trace))\s*\(/g;
const GO_LOG =
	/(?<![\w.])(?:log\.(?:Print\w*|Fatal\w*|Panic\w*)|fmt\.(?:Print\w*|Fprint\w*)|slog\.\w+)\s*\(/g;
const TS_EVENT =
	/(?<![\w$.]|function\s)(?:logEvent|logEventAsync)\s*\(|\beventLog\.(?:create|createMany)\s*\(/g;

function lineOf(src: string, index: number): number {
	let n = 1;
	for (let i = 0; i < index; i++) if (src.charCodeAt(i) === 10) n++;
	return n;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 120);

/** The top-level parts of an object literal body, split on commas. */
function topLevelParts(body: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let cur = "";
	for (let i = 0; i < body.length; i++) {
		const c = body[i] as string;
		if (c === '"' || c === "'" || c === "`") {
			const e = skipQuoted(body, i, c);
			cur += body.slice(i, e);
			i = e - 1;
			continue;
		}
		if (c === "(" || c === "[" || c === "{") depth++;
		else if (c === ")" || c === "]" || c === "}") depth--;
		if (c === "," && depth === 0) {
			parts.push(cur);
			cur = "";
		} else cur += c;
	}
	if (cur.trim()) parts.push(cur);
	return parts;
}

/** Keys of the `metadata: { ... }` literals in an event call; spreads and non-literals come back as `...`. */
export function metadataKeys(raw: string): string[] {
	const keys: string[] = [];
	for (const m of raw.matchAll(/(?<![\w$.])metadata\s*(:|,|\})/g)) {
		if (m[1] !== ":") {
			keys.push("..."); // shorthand `metadata`: a variable
			continue;
		}
		const at = (m.index ?? 0) + m[0].length;
		const rest = raw.slice(at).trimStart();
		const open = at + (raw.slice(at).length - rest.length);
		if (raw[open] !== "{") {
			keys.push("...");
			continue;
		}
		const obj = readBalanced(raw, open + 1, "{", "}", "ts");
		for (const part of topLevelParts(obj.raw)) {
			const p = part.replace(/\/\/.*$/gm, "").trim();
			if (!p) continue;
			if (p.startsWith("...")) {
				keys.push("...");
				continue;
			}
			const key = /^(?:"([^"]*)"|'([^']*)'|\[|([A-Za-z_$][\w$]*))/.exec(p);
			keys.push(key?.[1] ?? key?.[2] ?? key?.[3] ?? "...");
		}
	}
	return keys;
}

/** A call on a line that starts with a comment marker is commented out. */
function inComment(src: string, index: number): boolean {
	const start = src.lastIndexOf("\n", index - 1) + 1;
	return /^\s*(?:\/\/|\/\*|\*)/.test(src.slice(start, index));
}

export function scanSource(
	src: string,
	lang: Lang,
	eventKeys: ReadonlySet<string>,
): LogHit[] {
	const hits: LogHit[] = [];
	const logRe = lang === "go" ? GO_LOG : TS_LOG;
	for (const m of src.matchAll(logRe)) {
		if (inComment(src, m.index ?? 0)) continue;
		const at = (m.index ?? 0) + m[0].length;
		const call = readBalanced(src, at, "(", ")", lang);
		const bad = sensitiveIn(call.code);
		if (bad.length)
			hits.push({
				rule: "LOG-010",
				line: lineOf(src, m.index ?? 0),
				match: oneLine(m[0] + call.raw),
				why: bad.join(", "),
			});
	}
	if (lang === "ts") {
		for (const m of src.matchAll(TS_EVENT)) {
			if (inComment(src, m.index ?? 0)) continue;
			const at = (m.index ?? 0) + m[0].length;
			const call = readBalanced(src, at, "(", ")", lang);
			const bad = [
				...new Set(metadataKeys(call.raw).filter((k) => !eventKeys.has(k))),
			];
			if (bad.length)
				hits.push({
					rule: "LOG-020",
					line: lineOf(src, m.index ?? 0),
					match: oneLine(m[0] + call.raw),
					why: bad.join(", "),
				});
		}
	}
	return hits.sort((a, b) => a.line - b.line);
}
