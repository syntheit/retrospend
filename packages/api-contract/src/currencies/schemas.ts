import * as z from "zod";
import { currencyCodeSchema, rateTypeSchema } from "../common/money";
import { decimalStringSchema, idSchema, timestampSchema } from "../core";

/**
 * One stored exchange rate. Rates are quoted against the US dollar:
 * `unitsPerUsd` is how many units of `currency` one USD buys on `date`
 * (ARS blue 1450.00, BTC 0.000011). Convert with @retrospend/domain.
 */
export const exchangeRateSchema = z
	.object({
		id: idSchema,
		currency: currencyCodeSchema,
		type: rateTypeSchema,
		date: z.iso.date(),
		unitsPerUsd: decimalStringSchema,
		updatedAt: timestampSchema,
	})
	.meta({ id: "ExchangeRate" });

export type ExchangeRateDto = z.infer<typeof exchangeRateSchema>;

export const currencySchema = z
	.object({
		code: currencyCodeSchema,
		name: z.string(),
		symbol: z.string(),
		symbolNative: z.string(),
		/** Minor-unit digits: Money.minor is amount x 10^decimals. */
		decimals: z.int().min(0).max(18),
		kind: z.enum(["fiat", "crypto"]),
		/** Rate types this server has stored for the currency, sorted. */
		rateTypes: z.array(rateTypeSchema),
	})
	.meta({ id: "Currency" });
