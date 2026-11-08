/**
 * How a category name from a file is matched to a category the person has.
 * Names are stored as typed (a v1 client may save "Food "), but a file's
 * "Food" must still find it, so both sides key on the trimmed, lower-cased
 * name. Import review and the match step share this so they cannot disagree.
 */
export function categoryNameKey(name: string): string {
	return name.trim().toLowerCase();
}
