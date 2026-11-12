/**
 * Search text and the page cursor for the Activity read, as pure functions.
 *
 * Search ignores case and accents (RC-10): "almacen" finds "Almacén". Both
 * sides fold through the same letter table: in SQL (`translate`) for the
 * columns, or in the app layer when the stored text may be ciphertext, which
 * Postgres cannot match (search-scan.ts).
 */
import { pgLower } from "../search-fold";

/** Accented letters and what they fold to, one to one. */
export const FOLD_FROM = "áàâäãåéèêëíìîïóòôöõúùûüñçÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇ";
export const FOLD_TO = "aaaaaaeeeeiiiiooooouuuuncaaaaaaeeeeiiiiooooouuuunc";

const FOLD = new Map([...FOLD_FROM].map((c, i) => [c, [...FOLD_TO][i]]));

/**
 * The query folded as the old SQL folded a column: `lower(translate(col,
 * FOLD_FROM, FOLD_TO))`. Only the table's letters lose their accents, so
 * Cyrillic й and ё stay as they are on both sides. NFC first, so an accent
 * typed as a combining mark meets the table's precomposed letter.
 *
 * Lowercasing is per code point (pgLower), as Postgres lower() does on the
 * column. This changed from JS toLowerCase on the whole query, a bug fix on
 * the SQL path too: "ΟΔΟΣ" now folds to "οδοσ" (it used to get a final sigma
 * and miss the column) and "İstanbul" to "istanbul".
 */
export function foldText(text: string): string {
	return foldColumn(text.normalize("NFC"));
}

/**
 * A stored value folded for matching. Not normalized: the old SQL matched
 * columns as stored, so a title saved with a combining accent never matched
 * the precomposed letter, and still does not.
 */
export function foldColumn(text: string): string {
	let out = "";
	for (const c of text) out += FOLD.get(c) ?? c;
	return pgLower(out);
}

/** A LIKE pattern that matches `q` anywhere, its wildcards escaped (the SQL path). */
export function likePattern(q: string): string {
	return `%${foldText(q.trim()).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * The amounts a typed number can mean: "64000", "64,000" and "64.000" are
 * 64000; "12.99" and "12,99" are 12.99. Both readings of an ambiguous one
 * ("1,500") are kept. Empty when the text is not a number.
 */
export function amountCandidates(q: string): string[] {
	const text = q.trim().replace(/\s/g, "");
	if (!/^\d[\d.,]*$/.test(text) || /[.,]$/.test(text)) return [];
	const out = new Set<string>();
	const plain = (s: string) =>
		/^\d+(\.\d+)?$/.test(s) ? s.replace(/^0+(?=\d)/, "") : null;
	// en-US: commas group, a dot is the decimal point.
	const en = plain(text.replace(/,/g, ""));
	// es-AR and most of Europe: dots group, a comma is the decimal point.
	const es = plain(text.replace(/\./g, "").replace(",", "."));
	for (const v of [en, es]) if (v) out.add(v);
	return [...out];
}

/**
 * The sort key of a row, all descending: its date, then when it was added (so
 * the entry made last leads inside a day), then source, then id.
 */
export type CursorKey = { date: Date; created: Date; src: string; id: string };

/** Descending by the page's sort key; the same order the cursor is read in. */
export function byKeyDesc(a: CursorKey, b: CursorKey): number {
	return (
		b.date.getTime() - a.date.getTime() ||
		b.created.getTime() - a.created.getTime() ||
		(a.src === b.src ? 0 : a.src < b.src ? 1 : -1) ||
		(a.id === b.id ? 0 : a.id < b.id ? 1 : -1)
	);
}

/** Cursors made before `created` joined the key carry none; they page from the day's top. */
const NO_CREATED = new Date("9999-12-31T00:00:00.000Z");

export function encodeCursor(key: CursorKey): string {
	return Buffer.from(
		JSON.stringify([
			key.date.toISOString(),
			key.src,
			key.id,
			key.created.toISOString(),
		]),
	).toString("base64url");
}

/** The key a cursor names, or null for anything this server did not make. */
export function decodeCursor(cursor: string): CursorKey | null {
	try {
		const parsed: unknown = JSON.parse(
			Buffer.from(cursor, "base64url").toString("utf8"),
		);
		if (!Array.isArray(parsed) || (parsed.length !== 3 && parsed.length !== 4))
			return null;
		const [iso, src, id, made] = parsed;
		if (
			typeof iso !== "string" ||
			typeof src !== "string" ||
			typeof id !== "string" ||
			(made !== undefined && typeof made !== "string")
		)
			return null;
		const date = new Date(iso);
		const created = made === undefined ? NO_CREATED : new Date(made);
		if (
			Number.isNaN(date.getTime()) ||
			Number.isNaN(created.getTime()) ||
			!/^[psg]$/.test(src)
		)
			return null;
		return { date, created, src, id };
	} catch {
		return null;
	}
}
