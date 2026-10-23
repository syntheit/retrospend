import * as z from "zod";
import { v1 } from "../common/meta";
import { currencyCodeSchema, moneySchema } from "../common/money";
import { cursorQuerySchema, pageOf } from "../common/pagination";
import { idSchema, languageSchema, okSchema } from "../core";
import {
	categoryPreferenceSchema,
	favoriteRateSchema,
	PAGE_KEYS,
	pageSettingsInputSchema,
	pageSettingsSchema,
} from "./schemas";

export * from "./schemas";

/** Three-letter fiat code, the rule the web settings form uses. */
const fiatCodeSchema = z.string().regex(/^[A-Z]{3}$/);

export const generalSettingsSchema = z
	.object({
		homeCurrency: currencyCodeSchema,
		defaultCurrency: currencyCodeSchema,
		categoryClickBehavior: z.enum(["navigate", "toggle"]),
		currencySymbolStyle: z.enum(["native", "standard"]),
		/** Null until the user sets one. */
		monthlyIncome: moneySchema.nullable(),
		smartCurrencyFormatting: z.boolean(),
		defaultPrivacyMode: z.boolean(),
		autoAcceptSplits: z.boolean(),
		fiscalMonthStartDay: z.int().min(1).max(28),
		defaultExpenseDateBehavior: z.enum(["TODAY", "LAST_USED"]),
		aiMode: z.enum(["LOCAL", "EXTERNAL"]),
		language: languageSchema,
	})
	.meta({ id: "GeneralSettings" });

export type GeneralSettings = z.infer<typeof generalSettingsSchema>;

/**
 * A partial update: send only what changes. `monthlyIncome` null clears
 * it; its currency becomes the income currency.
 */
export const generalSettingsPatchSchema = z
	.object({
		homeCurrency: fiatCodeSchema,
		defaultCurrency: fiatCodeSchema,
		categoryClickBehavior: z.enum(["navigate", "toggle"]),
		currencySymbolStyle: z.enum(["native", "standard"]),
		monthlyIncome: moneySchema.extend({ minor: z.int().min(0) }).nullable(),
		smartCurrencyFormatting: z.boolean(),
		defaultPrivacyMode: z.boolean(),
		autoAcceptSplits: z.boolean(),
		fiscalMonthStartDay: z.int().min(1).max(28),
		defaultExpenseDateBehavior: z.enum(["TODAY", "LAST_USED"]),
		aiMode: z.enum(["LOCAL", "EXTERNAL"]),
		language: languageSchema,
	})
	.partial()
	.refine((v) => Object.keys(v).length > 0, "Send at least one field")
	.meta({ id: "GeneralSettingsPatch" });

const pageParamsSchema = z.object({ page: z.enum(PAGE_KEYS) });

const TAG = ["Settings"];

export const settingsContract = {
	get: v1
		.route({
			method: "GET",
			path: "/settings",
			operationId: "getSettings",
			tags: TAG,
			summary: "The caller's general settings",
		})
		.meta({ scope: "read" })
		.output(generalSettingsSchema),
	update: v1
		.route({
			method: "PATCH",
			path: "/settings",
			operationId: "updateSettings",
			tags: TAG,
			summary: "Change general settings",
		})
		.meta({ scope: "write:settings", event: "settings.updated" })
		.input(generalSettingsPatchSchema)
		.output(generalSettingsSchema),
	getPage: v1
		.route({
			method: "GET",
			path: "/settings/pages/{page}",
			operationId: "getPageSettings",
			tags: TAG,
			summary: "One page's view settings, defaults filled in",
		})
		.meta({ scope: "read" })
		.input(pageParamsSchema)
		.output(pageSettingsSchema),
	updatePage: v1
		.route({
			method: "PATCH",
			path: "/settings/pages/{page}",
			operationId: "updatePageSettings",
			tags: TAG,
			summary: "Merge changes into one page's view settings",
			description:
				"Fields that do not belong to the page are refused with validation_failed.",
		})
		.meta({ scope: "write:settings", event: "page_settings.updated" })
		.input(pageParamsSchema.extend({ settings: pageSettingsInputSchema }))
		.output(pageSettingsSchema),
	listCategoryPreferences: v1
		.route({
			method: "GET",
			path: "/settings/category-preferences",
			operationId: "listCategoryPreferences",
			tags: TAG,
			summary: "Which categories count as flexible spending",
			description:
				"Seeds defaults from category names the first time, as the web does.",
		})
		.meta({ scope: "read" })
		.input(cursorQuerySchema)
		.output(pageOf(categoryPreferenceSchema)),
	setCategoryPreference: v1
		.route({
			method: "PUT",
			path: "/settings/category-preferences/{categoryId}",
			operationId: "setCategoryPreference",
			tags: TAG,
			summary: "Mark a category flexible or fixed",
		})
		.meta({ scope: "write:settings", event: "category_preference.updated" })
		.input(z.object({ categoryId: idSchema, isFlexible: z.boolean() }))
		.output(categoryPreferenceSchema),
	deleteCategoryPreference: v1
		.route({
			method: "DELETE",
			path: "/settings/category-preferences/{categoryId}",
			operationId: "deleteCategoryPreference",
			tags: TAG,
			summary: "Forget a category's flexible flag",
		})
		.meta({ scope: "write:settings", event: "category_preference.deleted" })
		.input(z.object({ categoryId: idSchema }))
		.output(okSchema),
	listFavoriteRates: v1
		.route({
			method: "GET",
			path: "/settings/favorite-rates",
			operationId: "listFavoriteRates",
			tags: TAG,
			summary: "Pinned exchange rates, in the user's order",
		})
		.meta({ scope: "read" })
		.input(cursorQuerySchema)
		.output(pageOf(favoriteRateSchema)),
	addFavoriteRate: v1
		.route({
			method: "POST",
			path: "/settings/favorite-rates",
			operationId: "addFavoriteRate",
			tags: TAG,
			summary: "Pin an exchange rate (last in the order)",
			description: "Pinning one that is already pinned changes nothing.",
		})
		.meta({ scope: "write:settings", event: "favorite_rate.added" })
		.input(z.object({ exchangeRateId: idSchema }))
		.output(favoriteRateSchema),
	removeFavoriteRate: v1
		.route({
			method: "DELETE",
			path: "/settings/favorite-rates/{exchangeRateId}",
			operationId: "removeFavoriteRate",
			tags: TAG,
			summary: "Unpin an exchange rate",
		})
		.meta({ scope: "write:settings", event: "favorite_rate.removed" })
		.input(z.object({ exchangeRateId: idSchema }))
		.output(okSchema),
	reorderFavoriteRates: v1
		.route({
			method: "PUT",
			path: "/settings/favorite-rates/order",
			operationId: "reorderFavoriteRates",
			tags: TAG,
			summary: "Put pinned rates in this order",
			description: "Ids that are not pinned are ignored.",
		})
		.meta({ scope: "write:settings", event: "favorite_rates.reordered" })
		.input(z.object({ exchangeRateIds: z.array(idSchema).max(100) }))
		.output(okSchema),
};
