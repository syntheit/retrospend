/**
 * Text matching for search, in the app layer. Titles and notes can hold
 * ciphertext (docs/roadmap/e2ee-spike.md, lane D), so Postgres cannot match
 * them; the services fetch candidate rows by the plain filters, read the text
 * through `readUserText`, and match here.
 *
 * Each fold reproduces what its SQL did, so results for plaintext data are the
 * same as before:
 *
 * - `foldUnaccentIlike`: `immutable_unaccent(x) ILIKE ...` (v1 search).
 *   Postgres's unaccent rules (search-unaccent-rules.ts), then lower().
 * - `foldColumn` (expense-list/search.ts): `lower(translate(x, FOLD_FROM,
 *   FOLD_TO))` (Activity).
 *
 * `pgLower` lowercases one code point at a time, as Postgres's lower() does:
 * no context (a final sigma stays sigma) and "I with dot" becomes a plain i.
 */
import {
	FieldCryptoError,
	type Keyring,
	readField,
} from "../crypto/field-crypto";
import { UNACCENT_RULES } from "./search-unaccent-rules";

const RULES: ReadonlyMap<string, string> = new Map(
	UNACCENT_RULES.split("\n").map((line) => {
		const at = line.indexOf("=");
		return [
			String.fromCodePoint(Number.parseInt(line.slice(0, at), 16)),
			line.slice(at + 1),
		] as const;
	}),
);

export function pgLower(text: string): string {
	let out = "";
	for (const c of text) out += c === "İ" ? "i" : c.toLowerCase();
	return out;
}

/** Postgres's `unaccent()` with its default dictionary. */
export function unaccent(text: string): string {
	let out = "";
	for (const c of text) out += RULES.get(c) ?? c;
	return out;
}

/** Both sides of `immutable_unaccent(a) ILIKE immutable_unaccent(b)`. */
export function foldUnaccentIlike(text: string): string {
	return pgLower(unaccent(text));
}

/**
 * `lower(x) ILIKE '%' || q || '%'` as a predicate, which is what Prisma's
 * `contains` with `mode: "insensitive"` runs. Prisma does not escape the
 * pattern, so `%` and `_` in q are wildcards and a backslash escapes the next
 * character (a trailing one escapes the closing `%`). Matching is per code
 * point on `pgLower` text with the one-backtrack-point wildcard algorithm, so
 * a hostile q cannot make it slow.
 */
export function ilikeContains(query: string): (text: string) => boolean {
	type Token = { star: true } | { star: false; any: boolean; ch: string };
	const pattern = [...pgLower(`%${query}%`)];
	const tokens: Token[] = [];
	for (let i = 0; i < pattern.length; i++) {
		const c = pattern[i] as string;
		if (c === "\\") {
			i++;
			tokens.push({ star: false, any: false, ch: pattern[i] as string });
		} else if (c === "%") {
			if (!tokens.at(-1)?.star) tokens.push({ star: true });
		} else tokens.push({ star: false, any: c === "_", ch: c });
	}
	return (text) => {
		const t = [...pgLower(text)];
		let p = 0;
		let i = 0;
		let star = -1;
		let mark = 0;
		while (i < t.length) {
			const tok = tokens[p];
			if (tok?.star) {
				star = p++;
				mark = i;
			} else if (tok && (tok.any || tok.ch === t[i])) {
				p++;
				i++;
			} else if (star >= 0) {
				p = star + 1;
				i = ++mark;
			} else return false;
		}
		while (tokens[p]?.star) p++;
		return p === tokens.length;
	};
}

/**
 * The one switch between the two ways to match search text. Without a keyring
 * (field encryption is not active, the case today) Postgres matches in SQL
 * over every row. With one, text may be ciphertext, so candidates are read
 * and matched in the app layer over a bounded window: v1 search reads the
 * newest SEARCH_EXPENSE_WINDOW (20,000) expenses, Activity the newest
 * SEARCH_CANDIDATE_CAP (20,000) rows per source, so older rows are not found
 * on that path. D11 passes the user's keyring when DATA_KEYS_WRITE is on;
 * until then nothing supplies one.
 */
export function searchesInApp(
	keyring: Keyring | undefined,
): keyring is Keyring {
	return keyring !== undefined;
}

/** The text of a column that may hold ciphertext; null reads as empty. */
export function readUserText(
	keyring: Keyring | undefined,
	value: string | null | undefined,
	aad: { table: string; column: string; rowId: string },
): string {
	if (value === null || value === undefined) return "";
	if (!value.startsWith("\u0001")) return value;
	// Ciphertext with no key to open it is an error, never a silent non-match.
	if (!keyring) throw new FieldCryptoError("unknown_key");
	return readField(keyring, value, aad);
}
