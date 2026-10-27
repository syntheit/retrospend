import "./plural-rules";
import { useCalendars, useLocales } from "expo-localization";
import { type ReactNode, useMemo } from "react";
import { IntlProvider } from "use-intl";
import {
	type AppLocale,
	loadMessages,
	type Messages,
	resolveLocale,
} from "./i18n";
import { useLanguagePref } from "./language-pref";

declare module "use-intl" {
	interface AppConfig {
		Locale: AppLocale;
		Messages: Messages;
	}
}

/**
 * The language numbers follow ("Follow language" in Settings > Numbers): the
 * app language when one is chosen in Settings > Language, else the device's
 * region tag ("es-AR", "en-US"), which keeps its separators even when the
 * copy falls back to another catalog.
 */
export function useFormatLocale(): string {
	const device = useLocales()[0]?.languageTag ?? "en-US";
	const pref = useLanguagePref();
	return pref === "device" ? device : pref;
}

export function AppIntlProvider({ children }: { children: ReactNode }) {
	const device = useLocales();
	const pref = useLanguagePref();
	const timeZone = useCalendars()[0]?.timeZone ?? "UTC";
	// "Use device language" follows the phone's preferred languages, which
	// already reflect the per-app language set in the system settings.
	const locale = pref === "device" ? resolveLocale(device) : pref;
	const messages = useMemo(() => loadMessages(locale), [locale]);

	return (
		<IntlProvider locale={locale} messages={messages} timeZone={timeZone}>
			{children}
		</IntlProvider>
	);
}
