"use server";

import { cookies } from "next/headers";
import { DEFAULT_LOCALE, matchSupportedLocale } from "./locales";

/**
 * Stores the locale cookie for a stored language. A value that is only
 * non-canonical (legacy "es_AR", "pt", "en-US") is normalized; one that matches
 * nothing falls back to the default, so the cookie is always a supported code.
 */
export async function setLocaleCookie(locale: string) {
	const cookieStore = await cookies();
	cookieStore.set("locale", matchSupportedLocale(locale) ?? DEFAULT_LOCALE, {
		path: "/",
		maxAge: 60 * 60 * 24 * 365,
		sameSite: "lax",
	});
}
