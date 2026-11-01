"use client";

import {
	formatRate,
	formatRateValue,
	formatRateWithType,
	orientRate,
	orientRateAs,
	type RateInput,
} from "@retrospend/domain/rate-format";
import { useMemo } from "react";
import { useMoneyLocale } from "./use-money-locale";

/** A rate as the server sends it: one `unit` of a currency is `value` of another, `rate` unrounded. */
export type RatePairLike = {
	unit: { currency: string };
	value: { currency: string };
	rate: string;
};

/**
 * The one way a rate reads in the web app (R8): "1 USD = 1,545.20 ARS", the
 * direction whose number is at least 1, in the account's number format. A
 * type's name never shows without its number: "Blue · 1 USD = 1,545.20 ARS".
 * Every method gives null when there is no rate; a missing rate is never 1.
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
				p ? formatRate(p.unit.currency, p.value.currency, p.rate, locale) : null,
			/** "Blue · 1 USD = 1,545.20 ARS". */
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
			typed: (
				typeName: string,
				from: string,
				to: string,
				perFrom: RateInput,
			) => formatRateWithType(typeName, from, to, perFrom, locale),
			/** The number and the other code, in the direction that reads at least 1 ("1,545.20 ARS"). */
			number: (
				from: string,
				to: string,
				perFrom: RateInput,
			): string | null => {
				const o = orientRate(from, to, perFrom);
				return o ? `${formatRateValue(o.value, locale)} ${o.quote}` : null;
			},
			/**
			 * Just the number, with `base` as the single unit and the other
			 * currency's code after it ("1,545.20 ARS"): for a table whose
			 * header already says "1 USD =".
			 */
			inUnit: (
				base: string,
				from: string,
				to: string,
				perFrom: RateInput,
			): string | null => {
				const o = orientRateAs(base, from, to, perFrom);
				return o ? `${formatRateValue(o.value, locale)} ${o.quote}` : null;
			},
			/**
			 * A row of rates for one pair in one direction: the unit ("1 USD")
			 * and each rate's number, so the numbers can sit side by side.
			 */
			row: (
				from: string,
				to: string,
				rates: readonly RateInput[],
			): { unit: string; quote: string; values: (string | null)[] } | null => {
				const first = rates.map((r) => orientRate(from, to, r)).find(Boolean);
				if (!first) return null;
				return {
					unit: `1 ${first.base}`,
					quote: first.quote,
					values: rates.map((r) => {
						const o = orientRateAs(first.base, from, to, r);
						return o ? formatRateValue(o.value, locale) : null;
					}),
				};
			},
		}),
		[locale],
	);
}
