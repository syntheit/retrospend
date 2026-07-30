export const SUPPORTED_LOCALES = ["en", "es", "ru"] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "en";

export const LOCALE_OPTIONS = [
	{ value: "en", label: "English", flag: "EN" },
	{ value: "es", label: "Español", flag: "ES" },
	{ value: "ru", label: "Русский", flag: "RU" },
] as const satisfies readonly {
	value: AppLocale;
	label: string;
	flag: string;
}[];

export function matchSupportedLocale(
	value: string | null | undefined,
): AppLocale | undefined {
	if (!value) return undefined;

	const normalized = value.trim().replaceAll("_", "-").toLowerCase();
	const exactMatch = SUPPORTED_LOCALES.find(
		(locale) => locale.toLowerCase() === normalized,
	);
	if (exactMatch) return exactMatch;

	const language = normalized.split("-")[0];
	return SUPPORTED_LOCALES.find(
		(locale) => locale.toLowerCase().split("-")[0] === language,
	);
}

export function matchAcceptLanguage(value: string | null): AppLocale {
	if (!value) return DEFAULT_LOCALE;

	const preferences = value
		.split(",")
		.map((entry, index) => {
			const [language = "", ...parameters] = entry.trim().split(";");
			const qualityParameter = parameters.find((parameter) =>
				parameter.trim().startsWith("q="),
			);
			const parsedQuality = qualityParameter
				? Number.parseFloat(qualityParameter.trim().slice(2))
				: 1;

			return {
				language,
				quality: Number.isFinite(parsedQuality) ? parsedQuality : 0,
				index,
			};
		})
		.sort(
			(a, b) =>
				b.quality - a.quality ||
				a.index - b.index,
		);

	for (const preference of preferences) {
		if (preference.quality <= 0) continue;
		const locale = matchSupportedLocale(preference.language);
		if (locale) return locale;
	}

	return DEFAULT_LOCALE;
}
