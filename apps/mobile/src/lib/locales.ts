// The app's languages. No imports: app.config.ts reads this list to tell the
// systems (Android localeConfig, iOS CFBundleLocalizations) which languages
// the app speaks, so they show it in their per-app language settings.

export const APP_LOCALES = [
	"en",
	"es",
	"es-AR",
	"ru",
	"pt-BR",
	"fr",
	"de",
] as const;

export type AppLocale = (typeof APP_LOCALES)[number];

/** Each language in its own name, whatever language the app is showing. */
export const LANGUAGE_NAMES: Record<AppLocale, string> = {
	en: "English",
	es: "Español",
	"es-AR": "Español (Argentina)",
	ru: "Русский",
	"pt-BR": "Português (Brasil)",
	fr: "Français",
	de: "Deutsch",
};
