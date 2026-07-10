import { z } from "zod";
import { generateDefaultCategoryPreferences } from "~/lib/analytics-defaults";
import { BASE_CURRENCY, DEFAULT_PAGE_SIZE } from "~/lib/constants";
import type { db as globalDb } from "~/server/db";
import type { Page } from "~prisma";

type AppDb = typeof globalDb;

// Zod schemas for settings validation

// V1 schema (legacy — kept for migration)
export const DashboardSettingsV1Schema = z.object({
	version: z.literal(1),
	widgets: z.object({
		spendComposition: z.object({ visible: z.boolean() }),
		monthlyPacing: z.object({ visible: z.boolean() }),
		categoryTrends: z.object({ visible: z.boolean() }),
		recentExpenses: z.object({ visible: z.boolean() }),
		wealthAllocation: z.object({ visible: z.boolean() }),
	}),
});

const LayoutItemSchema = z.object({
	id: z.string(),
	visible: z.boolean(),
	size: z.enum(["xs", "sm", "md", "lg"]),
	order: z.number(),
});

// V2 schema (current — widget layout system)
export const DashboardSettingsSchema = z.object({
	version: z.literal(2),
	layout: z.array(LayoutItemSchema),
});

export type LayoutItem = z.infer<typeof LayoutItemSchema>;

const DEFAULT_DASHBOARD_LAYOUT: LayoutItem[] = [
	{ id: "safe-to-spend", visible: true, size: "sm", order: 0 },
	{ id: "monthly-summary", visible: true, size: "sm", order: 1 },
	{ id: "budget-pacing", visible: true, size: "lg", order: 2 },
	{ id: "recent-activity", visible: true, size: "md", order: 3 },
	{ id: "category-breakdown", visible: true, size: "md", order: 4 },
	{ id: "upcoming-recurring", visible: false, size: "md", order: 5 },
	{ id: "net-worth-snapshot", visible: false, size: "xs", order: 6 },
	{ id: "people-balances", visible: false, size: "xs", order: 7 },
	{ id: "pending-actions", visible: false, size: "xs", order: 8 },
	{ id: "currency-watchlist", visible: false, size: "xs", order: 9 },
	{ id: "savings-rate", visible: false, size: "xs", order: 10 },
	{ id: "monthly-comparison", visible: false, size: "md", order: 11 },
];

/** Migrate v1 dashboard settings to v2 layout format */
function migrateDashboardV1toV2(
	v1: z.infer<typeof DashboardSettingsV1Schema>,
): z.infer<typeof DashboardSettingsSchema> {
	// Map old widget keys to new widget IDs where possible
	const v1WidgetMap: Record<string, string> = {
		monthlyPacing: "budget-pacing",
		categoryTrends: "category-breakdown",
		recentExpenses: "recent-activity",
	};

	const layout = DEFAULT_DASHBOARD_LAYOUT.map((item) => {
		// Check if this widget had a v1 equivalent
		const v1Key = Object.entries(v1WidgetMap).find(
			([, newId]) => newId === item.id,
		)?.[0] as keyof typeof v1.widgets | undefined;

		if (v1Key && v1Key in v1.widgets) {
			return { ...item, visible: v1.widgets[v1Key].visible };
		}
		return item;
	});

	return { version: 2, layout };
}

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

// Union type for all page settings (v1 dashboard handled by migration, not in union)
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
		version: 2,
		layout: DEFAULT_DASHBOARD_LAYOUT,
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
		pageSize: DEFAULT_PAGE_SIZE,
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
	PROFILE: {
		version: 1,
	},
};

// Type helpers
export type DashboardSettingsV1 = z.infer<typeof DashboardSettingsV1Schema>;
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
	db: AppDb,
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
		// Auto-migrate v1 dashboard settings to v2
		if (page === "DASHBOARD") {
			const v1Result = DashboardSettingsV1Schema.safeParse(setting.settings);
			if (v1Result.success) {
				const v2 = migrateDashboardV1toV2(v1Result.data);
				await db.userPageSetting.update({
					where: { userId_page: { userId, page } },
					data: { settings: v2 },
				});
				return v2;
			}
		}

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
	db: AppDb,
	userId: string,
	page: T,
	settings: Partial<PageSettings>,
): Promise<PageSettings> {
	const currentSettings = await getPageSettings(db, userId, page);

	// Merge with updates
	const updatedSettings = { ...currentSettings, ...settings } as PageSettings;

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
			settings: JSON.parse(JSON.stringify(updatedSettings)),
		},
		create: {
			userId,
			page,
			settings: JSON.parse(JSON.stringify(updatedSettings)),
		},
	});

	return updatedSettings;
}

/**
 * Get analytics category preferences for a user
 */
export async function getAnalyticsCategoryPreferences(
	db: AppDb,
	userId: string,
) {
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
	db: AppDb,
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
	db: AppDb,
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

export async function ensureAnalyticsCategoryPreferences(
	db: AppDb,
	userId: string,
) {
	const existingPrefs = await getAnalyticsCategoryPreferences(db, userId);
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

	return await getAnalyticsCategoryPreferences(db, userId);
}

/**
 * Get all category preferences as a map for easy lookup
 * Ensures preferences exist by seeding defaults if needed
 */
export async function getAnalyticsCategoryPreferenceMap(
	db: AppDb,
	userId: string,
): Promise<Record<string, boolean>> {
	await ensureAnalyticsCategoryPreferences(db, userId);
	const preferences = await getAnalyticsCategoryPreferences(db, userId);
	return preferences.reduce(
		(map, pref) => {
			map[pref.categoryId] = pref.isFlexible;
			return map;
		},
		{} as Record<string, boolean>,
	);
}
