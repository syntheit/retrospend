/**
 * Search text and the page cursor for the Activity read, as pure functions.
 *
 * Search ignores case and accents (RC-10): "almacen" finds "Almacén". The
 * database has no unaccent extension, so both sides fold through the same
 * letter table: here for the query, in SQL (`translate`) for the columns.
 */

/** Accented letters and what they fold to, one to one (for SQL translate). */
export const FOLD_FROM = "áàâäãåéèêëíìîïóòôöõúùûüñçÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÑÇ";
export const FOLD_TO = "aaaaaaeeeeiiiiooooouuuuncaaaaaaeeeeiiiiooooouuuunc";

const FOLD = new Map([...FOLD_FROM].map((c, i) => [c, [...FOLD_TO][i]]));

/**
 * The query folded exactly as SQL folds a column: `lower(translate(col,
 * FOLD_FROM, FOLD_TO))`. Only the table's letters lose their accents, so
 * Cyrillic й and ё stay as they are on both sides. NFC first, so an accent
 * typed as a combining mark meets the table's precomposed letter.
 */
export function foldText(text: string): string {
	return [...text.normalize("NFC")]
		.map((c) => FOLD.get(c) ?? c)
		.join("")
		.toLowerCase();
}

/** A LIKE pattern that matches `q` anywhere, its wildcards escaped. */
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

/** The sort key of a row: newest first, then source, then id, all descending. */
export type CursorKey = { date: Date; src: string; id: string };

export function encodeCursor(key: CursorKey): string {
	return Buffer.from(
		JSON.stringify([key.date.toISOString(), key.src, key.id]),
	).toString("base64url");
}

/** The key a cursor names, or null for anything this server did not make. */
export function decodeCursor(cursor: string): CursorKey | null {
	try {
		const parsed: unknown = JSON.parse(
			Buffer.from(cursor, "base64url").toString("utf8"),
		);
		if (!Array.isArray(parsed) || parsed.length !== 3) return null;
		const [iso, src, id] = parsed;
		if (
			typeof iso !== "string" ||
			typeof src !== "string" ||
			typeof id !== "string"
		)
			return null;
		const date = new Date(iso);
		if (Number.isNaN(date.getTime()) || !/^[psg]$/.test(src)) return null;
		return { date, src, id };
	} catch {
		return null;
	}
}
