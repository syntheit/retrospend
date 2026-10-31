import * as z from "zod";
import { v1 } from "../common/meta";
import { currencyCodeSchema, rateTypeSchema } from "../common/money";
import { cursorQuerySchema, pageOf } from "../common/pagination";
import {
	decimalStringSchema,
	idSchema,
	okSchema,
	timestampSchema,
} from "../core";
import {
	conversionSchema,
	convertDirectionSchema,
	currencySchema,
	currencySpendingSchema,
	exchangeRateSchema,
	historyRangeSchema,
	rateHistorySchema,
	rateTableSchema,
} from "./schemas";

export * from "./schemas";

const TAG = ["Currencies"];

const currencyParamsSchema = z.object({ currency: currencyCodeSchema });

export const ratesQuerySchema = cursorQuerySchema.extend({
	currency: currencyCodeSchema.optional(),
	type: rateTypeSchema.optional(),
	date: z.iso.date().optional().meta({
		description: "The newest rate on or before this day; default today.",
	}),
});

export const rateHistoryQuerySchema = cursorQuerySchema.extend({
	type: rateTypeSchema.optional(),
	from: z.iso.date().optional(),
	to: z.iso.date().optional(),
});

export const rateSeriesQuerySchema = z.object({
	range: historyRangeSchema.default("3M").meta({
		description: "How far back: 1M, 3M, 1Y or ALL (every stored day).",
	}),
});

export const bestRateQuerySchema = z.object({
	date: z.iso.date().optional(),
	type: rateTypeSchema.optional().meta({
		description: "Preferred rate type; used when it exists for that day.",
	}),
});

export const bestRateSchema = z
	.object({
		currency: currencyCodeSchema,
		type: rateTypeSchema,
		date: z.iso.date(),
		unitsPerUsd: decimalStringSchema,
		/** The stored row; null for USD, which is 1 by definition. */
		exchangeRateId: idSchema.nullable(),
		/**
		 * False when the currency had no rate on or before the day, so the
		 * earliest later one was used (the web's fallback).
		 */
		onOrBefore: z.boolean(),
	})
	.meta({ id: "BestRate" });

export const rateSyncStatusSchema = z
	.object({
		/** Day of the newest stored rate, null before the first sync. */
		latestRateDate: z.iso.date().nullable(),
		/** When any rate row last changed. */
		lastUpdatedAt: timestampSchema.nullable(),
	})
	.meta({ id: "RateSyncStatus" });

export const convertQuerySchema = z.object({
	amount: z.coerce
		.number()
		.int()
		.min(0)
		.max(Number.MAX_SAFE_INTEGER)
		.meta({ description: "Minor units of the currency converted from." }),
	direction: convertDirectionSchema.meta({
		description:
			"toHome converts the currency into the home currency, fromHome the other way.",
	}),
});

export const currenciesContract = {
	list: v1
		.route({
			method: "GET",
			path: "/currencies",
			operationId: "listCurrencies",
			tags: TAG,
			summary: "Every currency the app knows, with its stored rate types",
		})
		.meta({ scope: "read" })
		.input(
			cursorQuerySchema.extend({ kind: z.enum(["fiat", "crypto"]).optional() }),
		)
		.output(pageOf(currencySchema)),
	listRates: v1
		.route({
			method: "GET",
			path: "/rates",
			operationId: "listRates",
			tags: TAG,
			summary: "The newest rate per currency and type on a day",
		})
		.meta({ scope: "read" })
		.input(ratesQuerySchema)
		.output(pageOf(exchangeRateSchema)),
	rateHistory: v1
		.route({
			method: "GET",
			path: "/rates/{currency}/history",
			operationId: "getRateHistory",
			tags: TAG,
			summary: "Stored rates for one currency, newest first",
		})
		.meta({ scope: "read" })
		.input(currencyParamsSchema.extend(rateHistoryQuerySchema.shape))
		.output(pageOf(exchangeRateSchema)),
	bestRate: v1
		.route({
			method: "GET",
			path: "/rates/{currency}/best",
			operationId: "getBestRate",
			tags: TAG,
			summary: "The rate the app would use for a currency on a day",
			description:
				"Same selection as saving an expense: the preferred type when it exists, else blue, official, crypto. not_found when the currency has no rates.",
		})
		.meta({ scope: "read" })
		.input(currencyParamsSchema.extend(bestRateQuerySchema.shape))
		.output(bestRateSchema),
	rateTable: v1
		.route({
			method: "GET",
			path: "/rates/table",
			operationId: "getRateTable",
			tags: TAG,
			summary: "Every currency priced in the home currency, per rate type",
			description:
				"What the Currencies screen shows: each price is the stronger currency of the pair in the weaker, with the caller's favorites and the open accounts in a currency with no rate. Nothing is ever priced at 1 for want of a rate.",
		})
		.meta({ scope: "read" })
		.output(rateTableSchema),
	rateSeries: v1
		.route({
			method: "GET",
			path: "/rates/{currency}/series",
			operationId: "getRateSeries",
			tags: TAG,
			summary: "A currency's rate history against the home currency",
			description:
				"One line per rate type, priced like the rate table: the stronger currency of the pair is the one unit, at the same decimal places on every point. Days come from the stored rate history; a side with no rate gives an empty series, never a 1.",
		})
		.meta({ scope: "read" })
		.input(currencyParamsSchema.extend(rateSeriesQuerySchema.shape))
		.output(rateHistorySchema),
	currencySpending: v1
		.route({
			method: "GET",
			path: "/currencies/{currency}/spending",
			operationId: "getCurrencySpending",
			tags: TAG,
			summary: "What the caller spent in one original currency",
			description:
				"All time, from the one spending definition Activity's footer uses. The list of those expenses is GET /expenses with filter=currency=CODE.",
		})
		.meta({ scope: "read" })
		.input(currencyParamsSchema)
		.output(currencySpendingSchema),
	convert: v1
		.route({
			method: "GET",
			path: "/rates/{currency}/convert",
			operationId: "convertAmount",
			tags: TAG,
			summary: "Convert an amount at every rate type of a currency",
			description:
				"To or from the home currency, rounded half to even to the target's minor unit. No results when either side has no rate.",
		})
		.meta({ scope: "read" })
		.input(currencyParamsSchema.extend(convertQuerySchema.shape))
		.output(conversionSchema),
	syncStatus: v1
		.route({
			method: "GET",
			path: "/rates/sync-status",
			operationId: "getRateSyncStatus",
			tags: TAG,
			summary: "How fresh the stored rates are",
		})
		.meta({ scope: "read" })
		.output(rateSyncStatusSchema),
	sync: v1
		.route({
			method: "POST",
			path: "/rates/sync",
			operationId: "syncRates",
			tags: TAG,
			summary: "Ask the worker to fetch rates now (admins)",
			successStatus: 202,
		})
		.meta({ scope: "admin", event: "rates.sync_requested" })
		.output(okSchema),
};
