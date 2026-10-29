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
import type enPush from "@retrospend/i18n/messages/en/push.json";
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
		features: {
			mobile: require("@retrospend/i18n/messages/en/mobile.json"),
			push: require("@retrospend/i18n/messages/en/push.json"),
		},
	}),
	es: (): LocaleFiles => ({
		shared: require("@retrospend/i18n/messages/es.json"),
		features: {
			mobile: require("@retrospend/i18n/messages/es/mobile.json"),
			push: require("@retrospend/i18n/messages/es/push.json"),
		},
	}),
	"es-AR": (): LocaleFiles => ({
		shared: require("@retrospend/i18n/messages/es-AR.json"),
		features: {
			mobile: require("@retrospend/i18n/messages/es-AR/mobile.json"),
			push: require("@retrospend/i18n/messages/es-AR/push.json"),
		},
	}),
	ru: (): LocaleFiles => ({
		shared: require("@retrospend/i18n/messages/ru.json"),
		features: {
			mobile: require("@retrospend/i18n/messages/ru/mobile.json"),
			push: require("@retrospend/i18n/messages/ru/push.json"),
		},
	}),
	"pt-BR": (): LocaleFiles => ({
		shared: require("@retrospend/i18n/messages/pt-BR.json"),
		features: {
			mobile: require("@retrospend/i18n/messages/pt-BR/mobile.json"),
			push: require("@retrospend/i18n/messages/pt-BR/push.json"),
		},
	}),
	fr: (): LocaleFiles => ({
		shared: require("@retrospend/i18n/messages/fr.json"),
		features: {
			mobile: require("@retrospend/i18n/messages/fr/mobile.json"),
			push: require("@retrospend/i18n/messages/fr/push.json"),
		},
	}),
	de: (): LocaleFiles => ({
		shared: require("@retrospend/i18n/messages/de.json"),
		features: {
			mobile: require("@retrospend/i18n/messages/de/mobile.json"),
			push: require("@retrospend/i18n/messages/de/push.json"),
		},
	}),
} satisfies Record<AppLocale, () => LocaleFiles>;

export type { AppLocale };
export const SUPPORTED_LOCALES: readonly AppLocale[] = APP_LOCALES;
export const DEFAULT_LOCALE: AppLocale = "en";

export type Messages = typeof en & {
	mobile: typeof enMobile;
	push: typeof enPush;
};

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
 * hand over "es-419-AR", "es-ES" or a bare "es" next to a region setting of
 * AR, so the tag's own region counts first (its last two-letter part), then
 * the region from the system settings, then the bare language. A language
 * with only a regional catalog takes it for any region: Portuguese from
 * Portugal reads the Brazilian catalog rather than English.
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
	const regional = (region: string | null | undefined) =>
		region && REGION.test(region)
			? supported(`${language}-${region}`)
			: undefined;
	return (
		regional(own) ??
		regional(settingsRegion) ??
		supported(language) ??
		SUPPORTED_LOCALES.find((l) => l.toLowerCase().startsWith(`${language}-`))
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
