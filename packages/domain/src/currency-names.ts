/**
 * A currency's name in the reader's language ("dólar estadounidense" in
 * es-AR), for pickers and search. Names come from the runtime's CLDR data;
 * codes it does not know (most crypto) fall back to the given name.
 */
const cache = new Map<string, Intl.DisplayNames | null>();

function displayNames(locale: string): Intl.DisplayNames | null {
	if (!cache.has(locale)) {
		try {
			cache.set(locale, new Intl.DisplayNames([locale], { type: "currency" }));
		} catch {
			cache.set(locale, null);
		}
	}
	return cache.get(locale) ?? null;
}

export function currencyName(
	code: string,
	locale: string,
	fallback: string = code,
): string {
	let name: string | undefined;
	try {
		name = displayNames(locale)?.of(code);
	} catch {
		name = undefined;
	}
	// An unknown code comes back as the code itself.
	return name && name !== code ? name : fallback;
}
