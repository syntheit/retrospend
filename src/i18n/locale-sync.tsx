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
		void setLocaleCookie(target)
			.then(() => {
				if (renderedLocale !== target && firstTry(target))
					window.location.reload();
			})
			.catch(() => undefined);
	}, [dbLocale, cookieLocale, renderedLocale]);

	return null;
}

const TRIED_KEY = "retrospend.localeSyncTried";

/**
 * One reload per language per tab. A browser that drops the cookie would
 * otherwise reload on every page, because each load sees it missing again.
 * Storage that throws (private modes) counts as already tried: no reload is
 * better than a loop.
 */
function firstTry(target: string): boolean {
	try {
		if (window.sessionStorage.getItem(TRIED_KEY) === target) return false;
		window.sessionStorage.setItem(TRIED_KEY, target);
		return true;
	} catch {
		return false;
	}
}
