import { mergeMessageCatalogs } from "@retrospend/i18n/catalog";
import { loadCatalog } from "@retrospend/i18n/load";
import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import {
	DEFAULT_LOCALE,
	matchAcceptLanguage,
	matchSupportedLocale,
} from "./locales";

export default getRequestConfig(async () => {
	const cookieStore = await cookies();
	const cookieLocale = matchSupportedLocale(cookieStore.get("locale")?.value);

	const headerStore = await headers();
	const locale =
		cookieLocale ??
		matchAcceptLanguage(headerStore.get("accept-language"));
	const englishMessages = await loadCatalog(DEFAULT_LOCALE);

	return {
		locale,
		messages:
			locale === DEFAULT_LOCALE
				? englishMessages
				: mergeMessageCatalogs(englishMessages, await loadCatalog(locale)),
	};
});
