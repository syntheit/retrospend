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
