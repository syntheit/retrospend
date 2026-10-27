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
