import * as z from "zod";
import {
	currencyCodeSchema,
	moneySchema,
	rateTypeSchema,
} from "../common/money";
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

/**
 * A price on the Currencies screen: `base` is worth 1 unit and the Money is
 * what it costs in the other currency of the pair, always the stronger
 * currency priced in the weaker (1 USD = ARS 1,555; 1 KWD = USD 3.26).
 * `minor` counts `places` decimal digits, at least the currency's own, so a
 * rate under one minor unit keeps its digits (USD 0.00064 is minor 64,
 * places 5). Clients format it with `places`; they never compute it.
 */
export const ratePriceSchema = z
	.object({
		minor: z.int(),
		currency: currencyCodeSchema,
		places: z.int().min(0).max(30),
		base: currencyCodeSchema,
	})
	.meta({ id: "RatePrice" });

export type RatePriceDto = z.infer<typeof ratePriceSchema>;

/** One rate type of a currency: its price, or null when it has none. */
export const currencyRateSchema = z
	.object({
		type: rateTypeSchema,
		price: ratePriceSchema.nullable(),
		/** Priced through another type's rate (one side lacks this type). */
		derived: z.boolean(),
	})
	.meta({ id: "CurrencyRate" });

/** A currency on the Currencies screen, priced in the home currency. */
export const rateTableRowSchema = z
	.object({
		code: currencyCodeSchema,
		crypto: z.boolean(),
		/** Its rate types in column order; empty when it has no rate. */
		rates: z.array(currencyRateSchema),
		/** The type new amounts use; null with no rate. */
		defaultType: rateTypeSchema.nullable(),
		favorite: z.boolean(),
		/** The exchange rate to pin when starring it; null when there is none (USD). */
		rateId: idSchema.nullable(),
		/** The pinned exchange rates to unpin when unstarring it. */
		favoriteIds: z.array(idSchema),
		/** Open accounts in this currency. */
		usedBy: z.array(z.string()),
	})
	.meta({ id: "RateTableRow" });

export type RateTableRowDto = z.infer<typeof rateTableRowSchema>;

export const rateTableSchema = z
	.object({
		home: currencyCodeSchema,
		/** Every rate type any row has, in column order. */
		columns: z.array(rateTypeSchema),
		/** Favorites first, then priced currencies, then by code. */
		rows: z.array(rateTableRowSchema),
		/** The one unit every price shares, or null when they differ. */
		base: currencyCodeSchema.nullable(),
		/** Day of the newest rate. */
		updated: z.iso.date().nullable(),
		/** The type new foreign amounts use. */
		homeDefault: rateTypeSchema.nullable(),
		/** Whether the default rate type can be changed yet. */
		canSetDefault: z.boolean(),
	})
	.meta({ id: "RateTable" });

export type RateTableDto = z.infer<typeof rateTableSchema>;

export const convertDirectionSchema = z.enum(["toHome", "fromHome"]);

export type ConvertDirection = z.infer<typeof convertDirectionSchema>;

/** An amount converted at every rate type of a currency, by the server. */
export const conversionSchema = z
	.object({
		/** The amount as asked. */
		from: moneySchema,
		results: z.array(
			z.object({
				type: rateTypeSchema,
				value: moneySchema,
				/** Converted through another type's rate. */
				derived: z.boolean(),
			}),
		),
	})
	.meta({ id: "Conversion" });

export type ConversionDto = z.infer<typeof conversionSchema>;
