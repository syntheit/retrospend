import * as z from "zod";
import { idSchema } from "../core";
import { exchangeRateSchema } from "../currencies/schemas";

/**
 * Which marks amounts use, group mark first: "comma_dot" is 1,234.56,
 * "dot_comma" 1.234,56, "space_comma" 1 234,56. The settings carry null to
 * follow the app language.
 */
export const numberFormatSchema = z.enum([
	"comma_dot",
	"dot_comma",
	"space_comma",
]);

/**
 * Pages with stored view settings, as path keys. The server maps each to
 * its Page enum value (`invite-codes` is INVITE_CODES).
 */
export const PAGE_KEYS = [
	"budget",
	"analytics",
	"wealth",
	"exchange-rates",
	"settings",
	"table",
	"account",
	"invite-codes",
	"admin",
	"expense",
	"profile",
] as const;

export type PageKey = (typeof PAGE_KEYS)[number];

/**
 * Every field any page stores. Each page keeps only its own subset; the
 * server validates the merged result against that page's schema.
 */
const pageFields = {
	categoryPreferences: z.record(
		z.string(),
		z.object({ isFlexible: z.boolean() }),
	),
	showRolloverAmounts: z.boolean(),
	showPegToActual: z.boolean(),
	showCurrencyExposure: z.boolean(),
	showHistoryChart: z.boolean(),
	showFavoritesOnly: z.boolean(),
	pageSize: z.int().min(10).max(100),
	showDescriptions: z.boolean(),
	showUsedCodes: z.boolean(),
	showInactiveUsers: z.boolean(),
	defaultCurrency: z.string().length(3),
	showExchangeRates: z.boolean(),
};

export const pageSettingsSchema = z
	.object({
		page: z.enum(PAGE_KEYS),
		settings: z
			.object({ version: z.int(), ...pageFields })
			.partial()
			.required({ version: true }),
	})
	.meta({ id: "PageSettings" });

export const pageSettingsInputSchema = z
	.strictObject(pageFields)
	.partial()
	.meta({ id: "PageSettingsPatch" });

export const categoryPreferenceSchema = z
	.object({
		categoryId: idSchema,
		categoryName: z.string(),
		isFlexible: z.boolean(),
	})
	.meta({ id: "CategoryPreference" });

export const favoriteRateSchema = z
	.object({
		exchangeRateId: idSchema,
		order: z.int(),
		rate: exchangeRateSchema,
	})
	.meta({ id: "FavoriteRate" });
