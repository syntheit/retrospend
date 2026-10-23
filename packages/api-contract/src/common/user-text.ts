/**
 * Free text a person types (titles, notes, names, match text). End-to-end
 * encryption stays possible only if the server can name every such field
 * (owner 2026-10-23, rule 1), so each one is declared through `userText`,
 * which records it in USER_TEXT_FIELDS. The server treats the value as
 * opaque (rule 11): a length check only, no trimming or case folding.
 */
import { z } from "zod";

const fields = new Set<string>();

/** Every declared user-text field, as "<entity>.<field>". */
export const USER_TEXT_FIELDS: ReadonlySet<string> = fields;

/** A user-text field of 1 to `max` characters (plaintext length, rule 6). */
export function userText(field: string, max: number) {
	fields.add(field);
	return z.string().min(1).max(max);
}
