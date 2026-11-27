"use client";

import { useLocale } from "next-intl";
import { useEffect, useRef } from "react";
import { setLocaleCookie } from "./actions";
import { DEFAULT_LOCALE, matchSupportedLocale } from "./locales";

/**
 * Syncs the user's DB language preference to the locale cookie. The cookie is
 * set whenever it is missing or differs; the page reloads only when it was
 * rendered in another language, so a new browser session that already got the
 * right language (Accept-Language) does not flash a reload.
 */
export function LocaleSync({
	dbLocale,
	cookieLocale,
}: {
	dbLocale: string;
	cookieLocale: string | undefined;
}) {
	const renderedLocale = useLocale();
	const synced = useRef(false);

	useEffect(() => {
		if (synced.current) return;
		const target = matchSupportedLocale(dbLocale) ?? DEFAULT_LOCALE;
		if (cookieLocale === target) return;
		synced.current = true;
		void setLocaleCookie(target).then(() => {
			if (renderedLocale !== target) window.location.reload();
		});
	}, [dbLocale, cookieLocale, renderedLocale]);

	return null;
}
