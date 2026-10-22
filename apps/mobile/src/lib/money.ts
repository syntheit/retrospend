// Money display goes through the one formatter in @retrospend/domain/format.
// The server computes every figure; the app only formats Money it receives.
import {
	type FormatMoneyOptions,
	formatMoney,
	formatMoneyPair,
} from "@retrospend/domain/format";
import type { Money } from "@retrospend/domain/money-minor";
import { useCallback } from "react";
import { useFormatLocale } from "./intl";

export type { Money };
export type MoneyOptions = Omit<FormatMoneyOptions, "locale">;

/** formatMoney bound to the device's number locale. */
export function useFormatMoney() {
	const locale = useFormatLocale();
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
