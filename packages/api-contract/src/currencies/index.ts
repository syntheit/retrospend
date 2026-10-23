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
import { currencySchema, exchangeRateSchema } from "./schemas";

export * from "./schemas";

const TAG = ["Currencies"];

const currencyParamsSchema = z.object({ currency: currencyCodeSchema });

export const ratesQuerySchema = cursorQuerySchema.extend({
	currency: currencyCodeSchema.optional(),
	type: rateTypeSchema.optional(),
	date: z.iso
		.date()
		.optional()
		.meta({
			description: "The newest rate on or before this day; default today.",
		}),
});

export const rateHistoryQuerySchema = cursorQuerySchema.extend({
	type: rateTypeSchema.optional(),
	from: z.iso.date().optional(),
	to: z.iso.date().optional(),
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
