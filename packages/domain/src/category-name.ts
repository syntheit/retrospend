/**
 * The one rule for what makes two category names the same name (M3,
 * slice-device-categories.md Decision 3): trim-exact. The text is compared
 * after trimming both ends and never folded, so "Food" and "Food " are one
 * name, "Food" and "food" are two, and a name of only spaces is no name.
 * Control characters are refused by the contract's `userText` before a name
 * gets here, so this rule never sees one.
 *
 * The server's name check (its fallback compare when a row has no usable
 * index) and the device's local check both call it. A name a person types is
 * stored as typed; only the compare trims.
 */

/** The text two names are compared by. */
export function trimmedCategoryName(name: string): string {
	return name.trim();
}

/** Whether two category names are the same name. */
export function sameCategoryName(a: string, b: string): boolean {
	return trimmedCategoryName(a) === trimmedCategoryName(b);
}

/** A name with nothing but spaces in it: refused before it is stored. */
export function isBlankCategoryName(name: string): boolean {
	return trimmedCategoryName(name).length === 0;
}
