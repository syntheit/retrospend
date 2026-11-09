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
 * `userText` can never hold text that looks like one. Every write path for a
 * declared field validates through it: the contract, the tRPC routers and the
 * service input schemas. Imports through the sidecar and rows written before
 * this rule are not covered, so D11 still scans existing rows for a leading
 * U+0001 before encrypting anything.
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

/**
 * Thrown by `stripUserTextControls` for text that starts with U+0001, the
 * marker of a field-encrypted value. Stripping it would turn a sealed value
 * that reached a write path unopened into the plaintext "k1:<base64>", so the
 * caller must refuse the row (an import) or fail loudly (a recurring post).
 */
export class SealedTextError extends Error {
	constructor() {
		super("Text starts with U+0001, the marker of an encrypted value");
		this.name = "SealedTextError";
	}
}

/**
 * The text with the characters `userText` refuses taken out: C0 controls
 * other than tab, line feed and carriage return, and lone surrogates.
 * Nothing else changes (no trim, no case folding, rule 11). For writes that
 * do not come from a form, such as imports and recurring posts, so one stray
 * control character in a file cannot make the row fail every later edit.
 *
 * Text that starts with U+0001 is not stripped: it throws `SealedTextError`.
 * A U+0001 anywhere else is an ordinary control character and is stripped.
 */
export function stripUserTextControls(text: string): string {
	if (text.charCodeAt(0) === 0x01) throw new SealedTextError();
	return removeForbidden(text);
}

/**
 * `stripUserTextControls` for reading rows that are already stored, to build a
 * comparison key. It never throws: a stored value that starts with U+0001 (an
 * old row written before the rule, or text that was not opened) is just text
 * with a control character in it, and the key drops it like any other. Never
 * use it to clean text that is about to be written.
 */
export function stripUserTextControlsForKey(text: string): string {
	return removeForbidden(text);
}

function removeForbidden(text: string): string {
	if (!hasForbiddenControl(text) && !hasLoneSurrogate(text)) return text;
	let out = "";
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		if (code < 0x20) {
			if (ALLOWED_C0.has(code)) out += text.charAt(i);
		} else if (code >= 0xd800 && code <= 0xdbff) {
			const next = text.charCodeAt(i + 1);
			if (next >= 0xdc00 && next <= 0xdfff) {
				out += text.slice(i, i + 2);
				i++;
			}
		} else if (code < 0xdc00 || code > 0xdfff) {
			out += text.charAt(i);
		}
	}
	return out;
}

function declare(field: string, max: number, required: boolean) {
	fields.add(field);
	const text = z.string();
	return (required ? text.min(1) : text)
		.max(max)
		.refine((value) => !hasForbiddenControl(value), {
			message: "Text cannot contain control characters",
		})
		.refine((value) => !hasLoneSurrogate(value), {
			message: "Text is not valid Unicode",
		});
}

/** A user-text field of 1 to `max` characters (plaintext length, rule 6). */
export function userText(field: string, max: number) {
	return declare(field, max, true);
}

/**
 * Like `userText`, and "" is valid too. For a route that already took an
 * empty string (a note cleared in the web app), so declaring the field
 * changes nothing but the content rules. New fields use `userText`.
 */
export function userTextOrEmpty(field: string, max: number) {
	return declare(field, max, false);
}
