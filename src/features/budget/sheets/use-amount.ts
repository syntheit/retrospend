"use client";

import { draftFromMinor } from "@retrospend/domain/parse";
import { useLocale } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { minorOf } from "./amount-cell";

/**
 * One typed amount in the book currency. It starts from a figure the server
 * gave (`initial`: the overspent amount, a cover suggestion) until the person
 * types; `minor` is what the text says, null while it is empty or unreadable.
 */
export function useAmount(currency: string, initial: number | null = null) {
	const locale = useLocale();
	const [text, setText] = useState("");
	const [typed, setTyped] = useState(false);

	useEffect(() => {
		if (typed || !currency || initial === null) return;
		setText(initial > 0 ? draftFromMinor(initial, locale, currency) : "");
	}, [initial, currency, locale, typed]);

	const set = useCallback((next: string) => {
		setTyped(true);
		setText(next);
	}, []);
	const minor = currency ? minorOf(text, locale, currency) : null;
	return { text, set, minor };
}
