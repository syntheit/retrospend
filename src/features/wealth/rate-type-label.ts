/**
 * A rate type's name. Known types (official, blue, card, MEP...) come from
 * the catalog; a type the sidecar adds later reads as its key, capitalized,
 * so a new type never shows a raw message key.
 */
export function rateTypeLabel(
	type: string,
	known: (key: string) => string | null,
): string {
	return known(type) ?? type.charAt(0).toUpperCase() + type.slice(1);
}
