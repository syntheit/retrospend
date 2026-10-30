import { CRYPTO_CURRENCIES } from "@retrospend/domain/currencies";

export interface CurrencySections {
	pinned: string[];
	yours: string[];
	recent: string[];
	fiat: string[];
	crypto: string[];
}

/** Crypto codes come from the one currencies table the web uses. */
export const isCrypto = (code: string) => code in CRYPTO_CURRENCIES;

/**
 * Who goes where in the currency picker: the pinned currencies (the stars on
 * the Currencies screen), then yours (home and default), then the ones used
 * lately, then every other fiat currency, then crypto. A code shows once, in
 * the first section that has it; codes outside `currencies` are dropped.
 * Each list keeps the order it came in.
 */
export function currencySections({
	currencies,
	pinned,
	yours,
	recent,
}: {
	currencies: readonly string[];
	pinned: readonly string[];
	yours: readonly string[];
	recent: readonly string[];
}): CurrencySections {
	const known = new Set(currencies);
	const taken = new Set<string>();
	const take = (codes: readonly string[]) =>
		codes.filter(
			(code) => known.has(code) && !taken.has(code) && taken.add(code),
		);
	const sections = {
		pinned: take(pinned),
		yours: take(yours),
		recent: take(recent),
		fiat: take(currencies.filter((code) => !isCrypto(code))),
		crypto: take(currencies.filter(isCrypto)),
	};
	return sections;
}

/** Recent picks first, then the ones the screen passed, each once. */
export function mergeRecent(
	picked: readonly string[],
	given: readonly string[],
): string[] {
	return [...new Set([...picked, ...given])];
}
