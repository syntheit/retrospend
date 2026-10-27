"use client";

import {
	type NumberFormatChoice,
	withNumberFormat,
} from "@retrospend/domain/format-locale";
import { useLocale } from "next-intl";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { api } from "~/trpc/react";

/** How the account wants amounts to read (Settings > Preferences). */
export interface MoneyPrefs {
	/** Null follows the language. */
	numberFormat: NumberFormatChoice | null;
	/** Undefined: only unambiguous symbols show, as before the setting existed. */
	symbolStyle?: "native" | "standard";
}

/**
 * A context, not a query, so a money component renders anywhere (a test, a
 * public page) and reads the language alone until a signed-in layout
 * provides the account's settings.
 */
const MoneyPrefsContext = createContext<MoneyPrefs>({ numberFormat: null });

/** Provides the signed-in account's money settings from its hydrated settings. */
export function MoneyPrefsProvider({ children }: { children: ReactNode }) {
	const { data } = api.settings.getGeneral.useQuery(undefined, {
		select: (s) => ({
			numberFormat: s.numberFormat,
			symbolStyle: s.currencySymbolStyle,
		}),
	});
	const numberFormat = data?.numberFormat ?? null;
	const symbolStyle = data?.symbolStyle;
	const value = useMemo(
		() => ({ numberFormat, symbolStyle }),
		[numberFormat, symbolStyle],
	);
	return (
		<MoneyPrefsContext.Provider value={value}>
			{children}
		</MoneyPrefsContext.Provider>
	);
}

/** Tests and previews: provide money settings without a query. */
export const MoneyPrefsValue = MoneyPrefsContext.Provider;

export function useMoneyPrefs(): MoneyPrefs {
	return useContext(MoneyPrefsContext);
}

/**
 * The locale every amount is formatted and typed in: the page language with
 * the account's number format on it. The setting sticks across language
 * changes. Money components and amount fields take their separators from
 * here and nowhere else.
 */
export function useMoneyLocale(): string {
	const locale = useLocale();
	const { numberFormat } = useContext(MoneyPrefsContext);
	return numberFormat ? withNumberFormat(locale, numberFormat) : locale;
}
