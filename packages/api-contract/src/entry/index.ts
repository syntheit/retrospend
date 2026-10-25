import * as z from "zod";
import { v1 } from "../common/meta";
import {
	currencyCodeSchema,
	moneySchema,
	rateTypeSchema,
} from "../common/money";
import { idSchema } from "../core";
import {
	amountTextSchema,
	daySchema,
	ratePairSchema,
	rateTextSchema,
} from "../ledger";

const TAG = ["Entry"];

export const entryCategorySchema = z
	.object({
		id: idSchema,
		name: z.string(),
		icon: z.string().nullable(),
		/** The category-n design token number. */
		tone: z.int(),
		kind: z.enum(["EXPENSE", "INCOME"]),
		/** Expenses in it start excluded from spending. */
		excludeByDefault: z.boolean(),
	})
	.meta({ id: "EntryCategory" });

export const entryPlaceSchema = z
	.object({
		id: idSchema,
		name: z.string(),
		type: z.string(),
		currency: currencyCodeSchema,
		/** What it is worth to you: a debt is negative. */
		balance: moneySchema,
		/** Part of your budget. */
		inBudget: z.boolean(),
		liability: z.boolean(),
	})
	.meta({ id: "EntryPlace" });

export const entryCatalogSchema = z
	.object({
		homeCurrency: currencyCodeSchema,
		/** Both kinds, the ones with the most expenses first. */
		categories: z.array(entryCategorySchema),
		/** Expense categories used most in the last 45 days. */
		recentCategoryIds: z.array(idSchema),
		/** Open accounts money can go to or come from. */
		places: z.array(entryPlaceSchema),
		/** The default account id per currency: a prefill only. */
		defaultAccounts: z.record(z.string(), idSchema),
	})
	.meta({ id: "EntryCatalog" });

export const rateOptionsQuerySchema = z
	.object({
		currency: currencyCodeSchema,
		date: daySchema,
		amount: amountTextSchema.optional().meta({
			description: "The amount to book at each type, as typed.",
		}),
		customRate: rateTextSchema.optional().meta({
			description: "A typed rate: 1 unit of `currency` = this much home.",
		}),
	})
	.meta({ id: "RateOptionsQuery" });

const rateOptionSchema = z.object({
	rateType: rateTypeSchema,
	rate: ratePairSchema,
	/** The amount asked, booked at this type; null when none was asked. */
	home: moneySchema.nullable(),
});

export const rateOptionsSchema = z
	.object({
		homeCurrency: currencyCodeSchema,
		/** The type the strip starts on. */
		defaultType: rateTypeSchema.nullable(),
		/** One per type the pair offers, in picker order. Empty for your home currency. */
		options: z.array(rateOptionSchema),
		/** No rate at all for the pair: saving is blocked (a missing rate is never 1). */
		missing: z.object({ currency: currencyCodeSchema }).nullable(),
		/** The typed rate, booked as Save books it; null when none was typed. */
		custom: rateOptionSchema.nullable(),
	})
	.meta({ id: "RateOptions" });

export const defaultRateTypesSchema = z
	.object({
		items: z.array(
			z.object({ homeCurrency: currencyCodeSchema, rateType: rateTypeSchema }),
		),
	})
	.meta({ id: "DefaultRateTypes" });

export const setDefaultRateTypeSchema = z
	.object({
		homeCurrency: currencyCodeSchema,
		rateType: rateTypeSchema.nullable().meta({
			description: "Null goes back to the built-in default. Custom is never a default.",
		}),
	})
	.meta({ id: "SetDefaultRateType" });

/**
 * What the Add sheets read before anything is typed: categories, recents and
 * places in one call, the rate strip, and the default rate type. Saving is
 * under /expenses, /income, /transfers and /shared-expenses.
 */
export const entryContract = {
	catalog: v1
		.route({
			method: "GET",
			path: "/entry/catalog",
			operationId: "getEntryCatalog",
			tags: TAG,
			summary: "Categories, recents and places for the Add sheets, in one call",
		})
		.meta({ scope: "read" })
		.output(entryCatalogSchema),
	rateOptions: v1
		.route({
			method: "GET",
			path: "/entry/rate-options",
			operationId: "getRateOptions",
			tags: TAG,
			summary: "Every rate type a pair offers, booked as saving would book it",
			description:
				"For an entry in `currency` on `date`. The rate and the amount in home are figures the server computes; show them as sent.",
		})
		.meta({ scope: "read" })
		.input(rateOptionsQuerySchema)
		.output(rateOptionsSchema),
	defaultRateTypes: v1
		.route({
			method: "GET",
			path: "/entry/default-rate-types",
			operationId: "listDefaultRateTypes",
			tags: TAG,
			summary: "The rate type the strip starts on, per home currency",
		})
		.meta({ scope: "read" })
		.output(defaultRateTypesSchema),
	setDefaultRateType: v1
		.route({
			method: "PUT",
			path: "/entry/default-rate-types/{homeCurrency}",
			operationId: "setDefaultRateType",
			tags: TAG,
			summary: "Choose the rate type the strip starts on",
			description: "A preference only: it moves no money.",
		})
		.meta({ scope: "write:settings", event: "default_rate_type.set" })
		.input(setDefaultRateTypeSchema)
		.output(defaultRateTypesSchema),
};
