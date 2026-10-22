// Message catalogs from @retrospend/i18n. The web loads them with
// import.meta.glob, which Metro does not support, so this file lists each
// locale's files by hand: the shared catalog plus every feature file the app
// uses. Assembly and the English fallback are the package's own functions.
import {
	assembleCatalog,
	type MessageCatalog,
	mergeMessageCatalogs,
} from "@retrospend/i18n/catalog";
import type enMobile from "@retrospend/i18n/messages/en/mobile.json";
import type en from "@retrospend/i18n/messages/en.json";

interface LocaleFiles {
	shared: MessageCatalog;
	features: Record<string, MessageCatalog>;
}

// require() keeps each locale lazy: only the one in use is evaluated.
const LOCALES = {
	en: (): LocaleFiles => ({
		shared: require("@retrospend/i18n/messages/en.json"),
		features: { mobile: require("@retrospend/i18n/messages/en/mobile.json") },
	}),
	es: (): LocaleFiles => ({
		shared: require("@retrospend/i18n/messages/es.json"),
		features: { mobile: require("@retrospend/i18n/messages/es/mobile.json") },
	}),
	"es-AR": (): LocaleFiles => ({
		shared: require("@retrospend/i18n/messages/es-AR.json"),
		features: {
			mobile: require("@retrospend/i18n/messages/es-AR/mobile.json"),
		},
	}),
	ru: (): LocaleFiles => ({
		shared: require("@retrospend/i18n/messages/ru.json"),
		features: { mobile: require("@retrospend/i18n/messages/ru/mobile.json") },
	}),
	"pt-BR": (): LocaleFiles => ({
		shared: require("@retrospend/i18n/messages/pt-BR.json"),
		features: {
			mobile: require("@retrospend/i18n/messages/pt-BR/mobile.json"),
		},
	}),
	fr: (): LocaleFiles => ({
		shared: require("@retrospend/i18n/messages/fr.json"),
		features: { mobile: require("@retrospend/i18n/messages/fr/mobile.json") },
	}),
	de: (): LocaleFiles => ({
		shared: require("@retrospend/i18n/messages/de.json"),
		features: { mobile: require("@retrospend/i18n/messages/de/mobile.json") },
	}),
} as const;

export type AppLocale = keyof typeof LOCALES;
export const SUPPORTED_LOCALES = Object.keys(LOCALES) as AppLocale[];
export const DEFAULT_LOCALE: AppLocale = "en";

export type Messages = typeof en & { mobile: typeof enMobile };

/**
 * The catalog locale for a device language tag: an exact match first
 * ("es-AR"), then the language alone ("es-MX" -> "es"), then English.
 */
export function matchLocale(tag: string | null | undefined): AppLocale {
	if (!tag) return DEFAULT_LOCALE;
	const normalized = tag.trim().replaceAll("_", "-").toLowerCase();
	const exact = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === normalized);
	if (exact) return exact;
	const language = normalized.split("-")[0];
	return SUPPORTED_LOCALES.find((l) => l === language) ?? DEFAULT_LOCALE;
}

function catalogOf(locale: AppLocale): MessageCatalog {
	const { shared, features } = LOCALES[locale]();
	return assembleCatalog(shared, features);
}

/** One locale's messages, with English filling any key it lacks. */
export function loadMessages(locale: AppLocale): Messages {
	const english = catalogOf(DEFAULT_LOCALE);
	const merged =
		locale === DEFAULT_LOCALE
			? english
			: mergeMessageCatalogs(english, catalogOf(locale));
	return merged as unknown as Messages;
}
