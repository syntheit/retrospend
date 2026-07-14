"use client";

import { useEffect, useRef } from "react";
import { setLocaleCookie } from "./actions";

/**
 * Syncs the user's DB language preference to the locale cookie.
 * If they differ, sets the cookie and reloads so next-intl picks it up.
 */
export function LocaleSync({
	dbLocale,
	cookieLocale,
}: {
	dbLocale: string;
	cookieLocale: string | undefined;
}) {
	const synced = useRef(false);

	useEffect(() => {
		if (synced.current) return;
		if (dbLocale && dbLocale !== cookieLocale) {
			synced.current = true;
			void setLocaleCookie(dbLocale).then(() => {
				window.location.reload();
			});
		}
	}, [dbLocale, cookieLocale]);

	return null;
}
