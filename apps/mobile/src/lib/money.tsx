// Money display goes through the one formatter in @retrospend/domain/format.
// The server computes every figure; the app only formats Money it receives.
import {
	type FormatMoneyOptions,
	formatMoney,
	formatMoneyPair,
} from "@retrospend/domain/format";
import {
	type NumberFormatChoice,
	withMoneyContext,
} from "@retrospend/domain/format-locale";
import type { Money } from "@retrospend/domain/money-minor";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
} from "react";
import { useSession } from "@/auth/session";
import { useFormatLocale } from "./intl";

export type { Money };
export type MoneyOptions = Omit<FormatMoneyOptions, "locale">;

/**
 * What the account says about how amounts read (set in Settings, shared with
 * the web): the number format and the home currency, the one currency shown
 * with a symbol.
 */
export interface MoneyPrefs {
	/** Null follows the language. */
	numberFormat: NumberFormatChoice | null;
	homeCurrency: string | null;
}

const DEFAULT_PREFS: MoneyPrefs = { numberFormat: null, homeCurrency: null };

const MoneyPrefsContext = createContext<MoneyPrefs>(DEFAULT_PREFS);

/**
 * Provides the account's number format and symbol style from the signed-in
 * profile (cached, so they hold offline). A profile cached before these
 * existed reads as the defaults. Without a provider (a test, a screen
 * outside the session) amounts follow the language.
 */
export function MoneyPrefsProvider({ children }: { children: ReactNode }) {
	const { state } = useSession();
	const me = state.status === "signedIn" ? state.me : null;
	const numberFormat = me?.numberFormat ?? null;
	const homeCurrency = me?.homeCurrency ?? null;
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

/** Tests and previews: provide money settings without a session. */
export const MoneyPrefsValue = MoneyPrefsContext.Provider;

export function useMoneyPrefs(): MoneyPrefs {
	return useContext(MoneyPrefsContext);
}

/**
 * The locale amounts are formatted and typed in: the app language with the
 * account's number format and home currency on it. Every money read and
 * every amount field takes its separators and its one symbol from this one
 * place.
 */
export function useMoneyLocale(): string {
	const locale = useFormatLocale();
	return withMoneyContext(locale, useMoneyPrefs());
}

/** formatMoney bound to the account's number format and home currency. */
export function useFormatMoney() {
	const locale = useMoneyLocale();
	const format = useCallback(
		(value: Money | null | undefined, options?: MoneyOptions) =>
			formatMoney(value, { locale, ...options }),
		[locale],
	);
	const pair = useCallback(
		(original: Money, home: Money | null | undefined, options?: MoneyOptions) =>
			formatMoneyPair(original, home, { locale, ...options }),
		[locale],
	);
	return { format, pair };
}
