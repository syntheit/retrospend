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
 * The app's language: the one chosen in Settings > Language, else the
 * catalog for the phone's preferred languages (which already reflect the
 * per-app language set in the system settings). Copy and numbers both read
 * it, so a screen never mixes one language's words with another's digits.
 */
export function useAppLocale(): AppLocale {
	const device = useLocales();
	const pref = useLanguagePref();
	return pref === "device" ? resolveLocale(device) : pref;
}

/**
 * The language numbers follow ("Follow language" in Settings > Numbers): the
 * app language, the same locale the web formats in for the same account.
 * Never the phone's region, which would give "1.545" here and "1,545" on the
 * web for one account.
 */
export function useFormatLocale(): string {
	return useAppLocale();
}

export function AppIntlProvider({ children }: { children: ReactNode }) {
	const timeZone = useCalendars()[0]?.timeZone ?? "UTC";
	const locale = useAppLocale();
	const messages = useMemo(() => loadMessages(locale), [locale]);

	return (
		<IntlProvider locale={locale} messages={messages} timeZone={timeZone}>
			{children}
		</IntlProvider>
	);
}
