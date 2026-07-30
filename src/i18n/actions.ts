"use server";

import { cookies } from "next/headers";
import { matchSupportedLocale } from "./locales";

export async function setLocaleCookie(locale: string) {
	const supportedLocale = matchSupportedLocale(locale);
	if (!supportedLocale || supportedLocale !== locale) {
		throw new Error("Unsupported locale");
	}

	const cookieStore = await cookies();
	cookieStore.set("locale", supportedLocale, {
		path: "/",
		maxAge: 60 * 60 * 24 * 365,
		sameSite: "lax",
	});
}
