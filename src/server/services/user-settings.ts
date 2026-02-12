import { z } from "zod";
import { generateDefaultCategoryPreferences } from "~/lib/analytics-defaults";
import { BASE_CURRENCY } from "~/lib/constants";
import { db } from "~/server/db";
import type { Page } from "~prisma";

// Zod schemas for settings validation
export const DashboardSettingsSchema = z.object({
	version: z.literal(1),
	widgets: z.object({
		spendComposition: z.object({ visible: z.boolean() }),
		monthlyPacing: z.object({ visible: z.boolean() }),
		activityHeatmap: z.object({ visible: z.boolean() }),
		categoryTrends: z.object({ visible: z.boolean() }),
		recentExpenses: z.object({ visible: z.boolean() }),
		wealthAllocation: z.object({ visible: z.boolean() }),
	}),
});

export const AnalyticsSettingsSchema = z.object({
	version: z.literal(1),
	categoryPreferences: z.record(
		z.string(),
		z.object({
			isFlexible: z.boolean(),
		}),
	),
});

export const BudgetSettingsSchema = z.object({
	version: z.literal(1),
	showRolloverAmounts: z.boolean(),
	showPegToActual: z.boolean(),
});

export const WealthSettingsSchema = z.object({
	version: z.literal(1),
	showCurrencyExposure: z.boolean(),
	showHistoryChart: z.boolean(),
});

export const ExchangeRatesSettingsSchema = z.object({
	version: z.literal(1),
	showFavoritesOnly: z.boolean(),
});

export const SettingsSchema = z.object({
	version: z.literal(1),
	// General app settings can be added here
});

export const TableSettingsSchema = z.object({
	version: z.literal(1),
	pageSize: z.number().min(10).max(100),
	showDescriptions: z.boolean(),
});

export const AccountSettingsSchema = z.object({
	version: z.literal(1),
	// Account-specific settings
});

export const InviteCodesSettingsSchema = z.object({
	version: z.literal(1),
	showUsedCodes: z.boolean(),
});

export const AdminSettingsSchema = z.object({
	version: z.literal(1),
	showInactiveUsers: z.boolean(),
});

export const ExpenseSettingsSchema = z.object({
	version: z.literal(1),
	defaultCurrency: z.string().length(3),
	showExchangeRates: z.boolean(),
});

// Union type for all page settings
export const PageSettingsSchema = z.union([
	DashboardSettingsSchema,
	AnalyticsSettingsSchema,
	BudgetSettingsSchema,
	WealthSettingsSchema,
	ExchangeRatesSettingsSchema,
	SettingsSchema,
	TableSettingsSchema,
	AccountSettingsSchema,
	InviteCodesSettingsSchema,
	AdminSettingsSchema,
	ExpenseSettingsSchema,
]);

// Default settings for each page
export const DEFAULT_PAGE_SETTINGS: Record<
	Page,
	z.infer<typeof PageSettingsSchema>
> = {
	DASHBOARD: {
		version: 1,
		widgets: {
			spendComposition: { visible: true },
			monthlyPacing: { visible: true },
			activityHeatmap: { visible: true },
			categoryTrends: { visible: true },
			recentExpenses: { visible: true },
			wealthAllocation: { visible: true },
		},
	},
	ANALYTICS: {
		version: 1,
		categoryPreferences: {},
	},
	BUDGET: {
		version: 1,
		showRolloverAmounts: true,
		showPegToActual: true,
	},
	WEALTH: {
		version: 1,
		showCurrencyExposure: true,
		showHistoryChart: true,
	},
	EXCHANGE_RATES: {
		version: 1,
		showFavoritesOnly: false,
	},
	SETTINGS: {
		version: 1,
	},
	TABLE: {
		version: 1,
		pageSize: 50,
		showDescriptions: true,
	},
	ACCOUNT: {
		version: 1,
	},
	INVITE_CODES: {
		version: 1,
		showUsedCodes: true,
	},
	ADMIN: {
		version: 1,
		showInactiveUsers: true,
	},
	EXPENSE: {
		version: 1,
		defaultCurrency: BASE_CURRENCY,
		showExchangeRates: true,
	},
};

// Type helpers
export type DashboardSettings = z.infer<typeof DashboardSettingsSchema>;
export type AnalyticsSettings = z.infer<typeof AnalyticsSettingsSchema>;
export type BudgetSettings = z.infer<typeof BudgetSettingsSchema>;
export type WealthSettings = z.infer<typeof WealthSettingsSchema>;
export type ExchangeRatesSettings = z.infer<typeof ExchangeRatesSettingsSchema>;
export type SettingsSettings = z.infer<typeof SettingsSchema>;
export type TableSettings = z.infer<typeof TableSettingsSchema>;
export type AccountSettings = z.infer<typeof AccountSettingsSchema>;
export type InviteCodesSettings = z.infer<typeof InviteCodesSettingsSchema>;
export type AdminSettings = z.infer<typeof AdminSettingsSchema>;
export type ExpenseSettings = z.infer<typeof ExpenseSettingsSchema>;
export type PageSettings = z.infer<typeof PageSettingsSchema>;

/**
 * Get page settings for a user, merging with defaults if no settings exist
 */
export async function getPageSettings<T extends Page>(
	userId: string,
	page: T,
): Promise<PageSettings> {
	const setting = await db.userPageSetting.findUnique({
		where: {
			userId_page: {
				userId,
				page,
			},
		},
	});

	if (!setting) {
		return DEFAULT_PAGE_SETTINGS[page];
	}

	try {
		const parsed = PageSettingsSchema.parse(setting.settings);
		return parsed;
	} catch {
		return DEFAULT_PAGE_SETTINGS[page];
	}
}

/**
 * Update page settings for a user
 */
export async function updatePageSettings<T extends Page>(
	userId: string,
	page: T,
	settings: Partial<PageSettings>,
): Promise<PageSettings> {
	const currentSettings = await getPageSettings(userId, page);

	// Merge with updates
	const updatedSettings = { ...currentSettings, ...settings };

	// Validate the merged settings
	PageSettingsSchema.parse(updatedSettings);

	// Save to database
	await db.userPageSetting.upsert({
		where: {
			userId_page: {
				userId,
				page,
			},
		},
		update: {
			settings: updatedSettings,
		},
		create: {
			userId,
			page,
			settings: updatedSettings,
		},
	});

	return updatedSettings;
}

/**
 * Get analytics category preferences for a user
 */
export async function getAnalyticsCategoryPreferences(userId: string) {
	return await db.analyticsCategoryPreference.findMany({
		where: { userId },
		include: {
			category: {
				select: {
					id: true,
					name: true,
					color: true,
				},
			},
		},
	});
}

/**
 * Update analytics category preference for a user
 */
export async function updateAnalyticsCategoryPreference(
	userId: string,
	categoryId: string,
	isFlexible: boolean,
) {
	return await db.analyticsCategoryPreference.upsert({
		where: {
			userId_categoryId: {
				userId,
				categoryId,
			},
		},
		update: {
			isFlexible,
		},
		create: {
			userId,
			categoryId,
			isFlexible,
		},
	});
}

export async function deleteAnalyticsCategoryPreference(
	userId: string,
	categoryId: string,
) {
	return await db.analyticsCategoryPreference.deleteMany({
		where: {
			userId,
			categoryId,
		},
	});
}

/**
 * Ensure analytics category preferences exist for a user.
 * If no preferences exist, creates default preferences based on category names.
 */

export async function ensureAnalyticsCategoryPreferences(userId: string) {
	const existingPrefs = await getAnalyticsCategoryPreferences(userId);
	if (existingPrefs.length > 0) {
		return existingPrefs;
	}

	// No preferences exist, create defaults
	const userCategories = await db.category.findMany({
		where: { userId },
		select: {
			id: true,
			name: true,
		},
	});

	const defaultPreferences = generateDefaultCategoryPreferences(userCategories);

	// Upsert preferences in bulk
	const upsertPromises = Object.entries(defaultPreferences).map(
		([categoryId, isFlexible]) =>
			db.analyticsCategoryPreference.upsert({
				where: {
					userId_categoryId: {
						userId,
						categoryId,
					},
				},
				update: { isFlexible },
				create: {
					userId,
					categoryId,
					isFlexible,
				},
			}),
	);

	await Promise.all(upsertPromises);

	return await getAnalyticsCategoryPreferences(userId);
}

/**
 * Get all category preferences as a map for easy lookup
 * Ensures preferences exist by seeding defaults if needed
 */
export async function getAnalyticsCategoryPreferenceMap(
	userId: string,
): Promise<Record<string, boolean>> {
	await ensureAnalyticsCategoryPreferences(userId);
	const preferences = await getAnalyticsCategoryPreferences(userId);
	return preferences.reduce(
		(map, pref) => {
			map[pref.categoryId] = pref.isFlexible;
			return map;
		},
		{} as Record<string, boolean>,
	);
}
