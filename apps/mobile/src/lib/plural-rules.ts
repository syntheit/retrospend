// Hermes on iOS has no Intl.PluralRules, and every ICU "plural" message
// (use-intl formats them with it) throws without one. This is the cardinal
// rule set for the app's own languages, installed only where the engine has
// none. Ordinals are not used by the app and read as "other".

type Category = "zero" | "one" | "two" | "few" | "many" | "other";

const isInteger = (n: number) => Number.isInteger(n);

const RULES: Record<string, (n: number) => Category> = {
	// One for exactly 1: English, German, Spanish.
	one: (n) => (n === 1 ? "one" : "other"),
	// Spanish and French also have "many" for 1,000,000 and its multiples.
	millions: (n) =>
		n === 1 ? "one" : n !== 0 && n % 1_000_000 === 0 ? "many" : "other",
	// Portuguese (Brazil) and French count 0 and 1 as one.
	zeroOrOne: (n) =>
		n >= 0 && n < 2 ? "one" : n !== 0 && n % 1_000_000 === 0 ? "many" : "other",
	ru: (n) => {
		if (!isInteger(n)) return "other";
		const tens = n % 100;
		const ones = n % 10;
		if (ones === 1 && tens !== 11) return "one";
		if (ones >= 2 && ones <= 4 && (tens < 12 || tens > 14)) return "few";
		return "many";
	},
};

export function pluralCategory(locale: string, count: number): Category {
	const n = Math.abs(count);
	const language = locale.toLowerCase().split(/[-_]/)[0] ?? "";
	if (language === "ru") return RULES.ru?.(n) ?? "other";
	if (language === "es") return RULES.millions?.(n) ?? "other";
	if (language === "fr") return RULES.zeroOrOne?.(n) ?? "other";
	if (language === "pt") return RULES.zeroOrOne?.(n) ?? "other";
	return RULES.one?.(n) ?? "other";
}

class PluralRulesShim {
	private readonly locale: string;
	private readonly type: "cardinal" | "ordinal";

	constructor(
		locales?: string | string[],
		options?: { type?: "cardinal" | "ordinal" },
	) {
		this.locale = (Array.isArray(locales) ? locales[0] : locales) ?? "en";
		this.type = options?.type ?? "cardinal";
	}

	select(n: number): Category {
		return this.type === "ordinal" ? "other" : pluralCategory(this.locale, n);
	}

	resolvedOptions() {
		return { locale: this.locale, type: this.type };
	}

	static supportedLocalesOf(locales?: string | string[]): string[] {
		return locales === undefined
			? []
			: Array.isArray(locales)
				? locales
				: [locales];
	}
}

/** Installs the shim when the engine has no Intl.PluralRules. */
export function installPluralRules(target: typeof Intl = Intl): void {
	if (typeof target.PluralRules === "function") return;
	(target as unknown as { PluralRules: unknown }).PluralRules = PluralRulesShim;
}

installPluralRules();
