import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import englishMessages from "../../messages/en.json";
import {
	DEFAULT_LOCALE,
	matchAcceptLanguage,
	matchSupportedLocale,
} from "./locales";
import { mergeMessageCatalogs } from "./messages";

export default getRequestConfig(async () => {
	const cookieStore = await cookies();
	const cookieLocale = matchSupportedLocale(cookieStore.get("locale")?.value);

	const headerStore = await headers();
	const locale =
		cookieLocale ??
		matchAcceptLanguage(headerStore.get("accept-language"));
	const localizedMessages =
		locale === DEFAULT_LOCALE
			? englishMessages
			: (await import(`../../messages/${locale}.json`)).default;

	return {
		locale,
		messages:
			locale === DEFAULT_LOCALE
				? englishMessages
				: mergeMessageCatalogs(englishMessages, localizedMessages),
	};
});
