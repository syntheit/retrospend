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
import { APP_LOCALES, type AppLocale } from "./locales";

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
} satisfies Record<AppLocale, () => LocaleFiles>;

export type { AppLocale };
export const SUPPORTED_LOCALES: readonly AppLocale[] = APP_LOCALES;
export const DEFAULT_LOCALE: AppLocale = "en";

export type Messages = typeof en & { mobile: typeof enMobile };

/** What expo-localization reports for one preferred language. */
export interface DeviceLocale {
	languageTag?: string | null;
	/** The region the user picked in system settings, apart from the language. */
	regionCode?: string | null;
}

const SCRIPT = /^[a-z]{4}$/i;
const REGION = /^([a-z]{2}|\d{3})$/i;

function supported(tag: string): AppLocale | undefined {
	return SUPPORTED_LOCALES.find((l) => l.toLowerCase() === tag.toLowerCase());
}

/**
 * The catalog for one language tag. The language with its region comes
 * before the bare language: "es-AR" is the voseo catalog, not "es". iOS can
 * hand over "es-419-AR" or a bare "es" next to a region setting of AR, so
 * the last two-letter region in the tag counts, and a tag with no region of
 * its own takes the region from the system settings.
 */
function matchTag(
	tag: string,
	settingsRegion: string | null | undefined,
): AppLocale | undefined {
	const parts = tag.trim().replaceAll("_", "-").split("-");
	const language = (parts[0] ?? "").toLowerCase();
	if (!language) return undefined;
	const rest = parts.slice(1).filter((p) => !SCRIPT.test(p));
	const own = rest.filter((p) => /^[a-z]{2}$/i.test(p)).at(-1);
	const generic = rest.length === 0 || rest.every((p) => /^\d{3}$/.test(p));
	const region = own ?? (generic ? settingsRegion : undefined);
	return (
		(region && REGION.test(region)
			? supported(`${language}-${region}`)
			: undefined) ?? supported(language)
	);
}

/**
 * The catalog for the device's preferred languages, in order: the first one
 * the app has a catalog for, else English.
 */
export function resolveLocale(
	locales: readonly DeviceLocale[] | null | undefined,
): AppLocale {
	for (const locale of locales ?? []) {
		if (!locale.languageTag) continue;
		const match = matchTag(locale.languageTag, locale.regionCode);
		if (match) return match;
	}
	return DEFAULT_LOCALE;
}

/** The catalog for one tag, with the system's region setting when given. */
export function matchLocale(
	tag: string | null | undefined,
	regionCode?: string | null,
): AppLocale {
	return resolveLocale([{ languageTag: tag, regionCode }]);
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
