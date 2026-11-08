/**
 * Free text a person types (titles, notes, names, match text). End-to-end
 * encryption stays possible only if the server can name every such field
 * (owner 2026-10-23, rule 1), so each one is declared through `userText`,
 * which records it in USER_TEXT_FIELDS. The server treats the value as
 * opaque (rule 11): a length check only, no trimming or case folding.
 *
 * The one content rule: no C0 control characters (U+0000 to U+001F), except
 * tab, line feed and carriage return, which notes and messages use. Server
 * field encryption marks a ciphertext with a leading U+0001 (lane D), so no
 * typed text may ever look like one.
 */
import { z } from "zod";

const fields = new Set<string>();

/** Every declared user-text field, as "<entity>.<field>". */
export const USER_TEXT_FIELDS: ReadonlySet<string> = fields;

const ALLOWED_C0 = new Set([0x09, 0x0a, 0x0d]);

/** True when `text` holds a C0 control character a person cannot type as text. */
export function hasForbiddenControl(text: string): boolean {
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		if (code < 0x20 && !ALLOWED_C0.has(code)) return true;
	}
	return false;
}

/** A user-text field of 1 to `max` characters (plaintext length, rule 6). */
export function userText(field: string, max: number) {
	fields.add(field);
	return z
		.string()
		.min(1)
		.max(max)
		.refine((value) => !hasForbiddenControl(value), {
			message: "Text cannot contain control characters",
		});
}
