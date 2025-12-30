/**
 * Default categories that are considered "fixed" (predictable expenses)
 * vs "flexible" (variable expenses) in analytics
 */
export const DEFAULT_FIXED_CATEGORIES = [
	"Rent",
	"Utilities",
	"Fees",
	"Taxes",
] as const;

export type FixedCategoryName = (typeof DEFAULT_FIXED_CATEGORIES)[number];

/**
 * Check if a category name is considered fixed by default
 */
export function isCategoryFixedByDefault(categoryName: string): boolean {
	return DEFAULT_FIXED_CATEGORIES.includes(categoryName as FixedCategoryName);
}

/**
 * Generate a default preference map for a user's categories
 * Categories in the fixed list are marked as fixed, others as flexible
 */
export function generateDefaultCategoryPreferences(
	userCategories: Array<{ id: string; name: string }>,
): Record<string, boolean> {
	const preferences: Record<string, boolean> = {};

	for (const category of userCategories) {
		// Default to flexible (true) unless in the fixed list
		preferences[category.id] = !isCategoryFixedByDefault(category.name);
	}

	return preferences;
}
