import {
	formatRate,
	formatRateValue,
	formatRateWithType,
	orientRate,
	orientRateAs,
	type RateInput,
} from "@retrospend/domain/rate-format";
import { useMemo } from "react";
import { useMoneyLocale } from "@/lib/money";

/** A rate as the server sends it: one `unit` of a currency is `value` of another, `rate` unrounded. */
export type RatePairLike = {
	unit: { currency: string };
	value: { currency: string };
	rate: string;
};

/**
 * The one way a rate reads in the app (R8), the same formatter the web uses:
 * "1 USD = 1,545.20 ARS", the direction whose number is at least 1, in the
 * account's number format. A type's name never shows without its number:
 * "Blue · 1 USD = 1,545.20 ARS". Every method gives null when there is no
 * rate; a missing rate is never 1.
 */
export function useRateFormat() {
	const locale = useMoneyLocale();
	return useMemo(
		() => ({
			/** "1 USD = 1,545.20 ARS" for `perFrom` units of `to` per one `from`. */
			rate: (from: string, to: string, perFrom: RateInput) =>
				formatRate(from, to, perFrom, locale),
			/** The same for a server rate pair. */
			pair: (p: RatePairLike | null | undefined) =>
				p
					? formatRate(p.unit.currency, p.value.currency, p.rate, locale)
					: null,
			/** "Blue · 1 USD = 1,545.20 ARS" for a server rate pair. */
			withType: (typeName: string, p: RatePairLike | null | undefined) =>
				p
					? formatRateWithType(
							typeName,
							p.unit.currency,
							p.value.currency,
							p.rate,
							locale,
						)
					: null,
			/** "Blue · 1 USD = 1,545.20 ARS" from the raw pair. */
			typed: (typeName: string, from: string, to: string, perFrom: RateInput) =>
				formatRateWithType(typeName, from, to, perFrom, locale),
			/** The number and the other code, in the direction that reads at least 1 ("1,545.20 ARS"). */
			number: (from: string, to: string, perFrom: RateInput): string | null => {
				const o = orientRate(from, to, perFrom);
				return o ? `${formatRateValue(o.value, locale)} ${o.quote}` : null;
			},
			/** Just the number and the other code ("1,545.20 ARS") with `base` as the one unit. */
			inUnit: (
				base: string,
				from: string,
				to: string,
				perFrom: RateInput,
			): string | null => {
				const o = orientRateAs(base, from, to, perFrom);
				return o ? `${formatRateValue(o.value, locale)} ${o.quote}` : null;
			},
			/** The direction a pair reads in: its single unit and the other code. */
			direction: (from: string, to: string, perFrom: RateInput) =>
				orientRate(from, to, perFrom),
		}),
		[locale],
	);
}
