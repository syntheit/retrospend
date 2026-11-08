/**
 * Free text a person types (titles, notes, names, match text). End-to-end
 * encryption stays possible only if the server can name every such field
 * (owner 2026-10-23, rule 1), so each one is declared through `userText`,
 * which records it in USER_TEXT_FIELDS. The server treats the value as
 * opaque (rule 11): a length check only, no trimming or case folding.
 *
 * Content rules: no C0 control characters (U+0000 to U+001F) except tab, line
 * feed and carriage return, which notes and messages use, and no lone
 * surrogates (they do not survive UTF-8). Server field encryption marks a
 * ciphertext with a leading U+0001 (lane D), so a field declared through
 * `userText` can never hold text that looks like one. That holds only for
 * fields declared here: many write paths still validate with a bare
 * z.string() (expense, shared transaction, people, recurring, settlement,
 * import queue, guest), as do imports, the sidecar and rows written before
 * this rule. D11 must move every encrypted field's write path to `userText`
 * and scan existing rows for a leading U+0001 before encrypting anything.
 */
import { z } from "zod";

const fields = new Set<string>();
const limits = new Map<string, number>();

/** Every declared user-text field, as "<entity>.<field>". */
export const USER_TEXT_FIELDS: ReadonlySet<string> = fields;

/**
 * The longest plaintext each declared field accepts, in UTF-16 units. A field
 * declared with several limits keeps the largest. The column that stores it
 * must hold the ciphertext of that much text (src/test/migrations).
 */
export const USER_TEXT_LIMITS: ReadonlyMap<string, number> = limits;

const ALLOWED_C0 = new Set([0x09, 0x0a, 0x0d]);

/** True when `text` holds a C0 control character a person cannot type as text. */
export function hasForbiddenControl(text: string): boolean {
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		if (code < 0x20 && !ALLOWED_C0.has(code)) return true;
	}
	return false;
}

/** True when `text` holds a surrogate that is not half of a valid pair. */
export function hasLoneSurrogate(text: string): boolean {
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = text.charCodeAt(i + 1);
			if (next >= 0xdc00 && next <= 0xdfff) i++;
			else return true;
		} else if (code >= 0xdc00 && code <= 0xdfff) return true;
	}
	return false;
}

/** A user-text field of 1 to `max` characters (plaintext length, rule 6). */
export function userText(field: string, max: number) {
	fields.add(field);
	limits.set(field, Math.max(limits.get(field) ?? 0, max));
	return z
		.string()
		.min(1)
		.max(max)
		.refine((value) => !hasForbiddenControl(value), {
			message: "Text cannot contain control characters",
		})
		.refine((value) => !hasLoneSurrogate(value), {
			message: "Text is not valid Unicode",
		});
}
