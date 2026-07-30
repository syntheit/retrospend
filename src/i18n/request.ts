import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";
import {
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

	return {
		locale,
		messages: (await import(`../../messages/${locale}.json`)).default,
	};
});
