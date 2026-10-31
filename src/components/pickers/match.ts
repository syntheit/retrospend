import { fold } from "@retrospend/domain/picker-match";

export { fold, splitRecent } from "@retrospend/domain/picker-match";

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
 * cmdk filter that ranks as well as matches: a name that starts with the
 * search beats one with a word that starts with it, which beats one that
 * only contains it. Enter picks the top item, so the best match is first.
 */
export function rankedFilter(
	_value: string,
	search: string,
	keywords: string[] = [],
): number {
	const q = fold(search);
	if (!q) return 1;
	let best = 0;
	for (const k of keywords) {
		const name = fold(k);
		const at = name.indexOf(q);
		if (at < 0) continue;
		const score = at === 0 ? 3 : name[at - 1] === " " ? 2 : 1;
		if (score > best) best = score;
	}
	return best;
}
