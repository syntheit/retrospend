"use client";

import {
	type MoneyContext,
	withMoneyContext,
} from "@retrospend/domain/format-locale";
import { useLocale } from "next-intl";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { api } from "~/trpc/react";

/**
 * What the account says about how amounts read: the number format (null
 * follows the language) and the home currency, the one currency shown with a
 * symbol. A context, not a query, so a money component renders anywhere (a
 * test, a public page) and reads the language alone until a signed-in layout
 * provides the account's settings.
 */
const MoneyPrefsContext = createContext<MoneyContext>({});

/** Provides the signed-in account's money settings from its hydrated settings. */
export function MoneyPrefsProvider({ children }: { children: ReactNode }) {
	const { data } = api.settings.getGeneral.useQuery(undefined, {
		select: (s) => ({
			numberFormat: s.numberFormat,
			homeCurrency: s.homeCurrency,
		}),
	});
	const numberFormat = data?.numberFormat ?? null;
	const homeCurrency = data?.homeCurrency ?? null;
	const value = useMemo(
		() => ({ numberFormat, homeCurrency }),
		[numberFormat, homeCurrency],
	);
	return (
		<MoneyPrefsContext.Provider value={value}>
			{children}
		</MoneyPrefsContext.Provider>
	);
}

/** Tests and previews: provide money settings without a query. */
export const MoneyPrefsValue = MoneyPrefsContext.Provider;

/**
 * The locale every amount is formatted and typed in: the page language with
 * the account's number format and home currency on it. The settings stick
 * across language changes. Money components and amount fields take their
 * separators and their one symbol from here and nowhere else.
 */
export function useMoneyLocale(): string {
	const locale = useLocale();
	const context = useContext(MoneyPrefsContext);
	return context.numberFormat || context.homeCurrency
		? withMoneyContext(locale, context)
		: locale;
}
