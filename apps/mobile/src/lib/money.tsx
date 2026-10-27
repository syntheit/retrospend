// Money display goes through the one formatter in @retrospend/domain/format.
// The server computes every figure; the app only formats Money it receives.
import {
	type FormatMoneyOptions,
	formatMoney,
	formatMoneyPair,
} from "@retrospend/domain/format";
import {
	type NumberFormatChoice,
	withNumberFormat,
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
export type MoneyOptions = Omit<FormatMoneyOptions, "locale" | "symbolStyle">;

/** What the account says about how amounts read (set in Settings, shared with the web). */
export interface MoneyPrefs {
	/** Null follows the language. */
	numberFormat: NumberFormatChoice | null;
	symbolStyle: "native" | "standard";
}

const DEFAULT_PREFS: MoneyPrefs = {
	numberFormat: null,
	symbolStyle: "standard",
};

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
	const symbolStyle = me?.currencySymbolStyle ?? "standard";
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

/** Tests and previews: provide money settings without a session. */
export const MoneyPrefsValue = MoneyPrefsContext.Provider;

export function useMoneyPrefs(): MoneyPrefs {
	return useContext(MoneyPrefsContext);
}

/**
 * The locale amounts are formatted and typed in: the device's number locale
 * with the account's number format on it. Every money read and every amount
 * field takes its separators from this one place.
 */
export function useMoneyLocale(): string {
	const locale = useFormatLocale();
	const { numberFormat } = useMoneyPrefs();
	return withNumberFormat(locale, numberFormat);
}

/** formatMoney bound to the account's number format and symbol style. */
export function useFormatMoney() {
	const locale = useMoneyLocale();
	const { symbolStyle } = useMoneyPrefs();
	const format = useCallback(
		(value: Money | null | undefined, options?: MoneyOptions) =>
			formatMoney(value, { locale, symbolStyle, ...options }),
		[locale, symbolStyle],
	);
	const pair = useCallback(
		(original: Money, home: Money | null | undefined, options?: MoneyOptions) =>
			formatMoneyPair(original, home, { locale, symbolStyle, ...options }),
		[locale, symbolStyle],
	);
	return { format, pair };
}
