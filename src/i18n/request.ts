import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";

const SUPPORTED_LOCALES = ["en", "es"];

export default getRequestConfig(async () => {
	const cookieStore = await cookies();
	let locale = cookieStore.get("locale")?.value;

	if (!locale || !SUPPORTED_LOCALES.includes(locale)) {
		// Fall back to browser language
		const headerStore = await headers();
		const acceptLanguage = headerStore.get("accept-language") ?? "";
		const preferred = acceptLanguage.split(",")[0]?.trim().toLowerCase() ?? "";
		locale = preferred.startsWith("es") ? "es" : "en";
	}

	return {
		locale,
		messages: (await import(`../../messages/${locale}.json`)).default,
	};
});
