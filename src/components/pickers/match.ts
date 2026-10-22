/** Letters NFD does not split into a base letter and a mark. */
const SPECIAL: Record<string, string> = {
	ß: "ss",
	ł: "l",
	ø: "o",
	đ: "d",
	ð: "d",
	þ: "th",
	æ: "ae",
	œ: "oe",
	ı: "i",
	ħ: "h",
};

/**
 * Picker search ignores case and accents: "lucia" finds Lucía, "cafe"
 * finds Café, "lodz" finds Łódź, "strasse" finds Straße.
 */
export function fold(s: string): string {
	return s
		.toLowerCase()
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.replace(/[ßłøđðþæœıħ]/g, (c) => SPECIAL[c] ?? c)
		.trim();
}

/** cmdk filter: an item matches when any of its words contains the search. */
export function pickerFilter(
	_value: string,
	search: string,
	keywords: string[] = [],
): number {
	const q = fold(search);
	if (!q) return 1;
	return keywords.some((k) => fold(k).includes(q)) ? 1 : 0;
}

/**
 * Recents first, then everything else in its own order; ids that are not in
 * the list (a deleted category) are dropped.
 */
export function splitRecent<T extends { id: string }>(
	items: readonly T[],
	recentIds: readonly string[] = [],
): { recent: T[]; rest: T[] } {
	const byId = new Map(items.map((i) => [i.id, i]));
	const recent = [...new Set(recentIds)]
		.map((id) => byId.get(id))
		.filter((i): i is T => !!i);
	const taken = new Set(recent.map((r) => r.id));
	return { recent, rest: items.filter((i) => !taken.has(i.id)) };
}
