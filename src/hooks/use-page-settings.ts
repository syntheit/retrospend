"use client";

import { api } from "~/trpc/react";
import type { Page } from "~prisma";
import type { PageSettings } from "~/server/services/user-settings";

/**
 * Hook for managing page settings
 */
export function usePageSettings<T extends Page>(page: T) {
	const { data: settings, ...queryResult } = api.settings.getPageSettings.useQuery({
		page,
	});

	const updateMutation = api.settings.updatePageSettings.useMutation();

	const updateSettings = async (updates: Partial<PageSettings>) => {
		return await updateMutation.mutateAsync({
			page,
			settings: updates,
		});
	};

	return {
		settings,
		updateSettings,
		isUpdating: updateMutation.isPending,
		...queryResult,
	};
}

/**
 * Hook for managing analytics category preferences
 */
export function useAnalyticsCategoryPreferences() {
	const { data: preferences, ...queryResult } = api.settings.getAnalyticsCategoryPreferences.useQuery();

	const { data: preferenceMap, ...mapQueryResult } = api.settings.getAnalyticsCategoryPreferenceMap.useQuery();

	const updateMutation = api.settings.updateAnalyticsCategoryPreference.useMutation();
	const deleteMutation = api.settings.deleteAnalyticsCategoryPreference.useMutation();

	const updatePreference = async (categoryId: string, isFlexible: boolean) => {
		return await updateMutation.mutateAsync({
			categoryId,
			isFlexible,
		});
	};

	const deletePreference = async (categoryId: string) => {
		return await deleteMutation.mutateAsync({
			categoryId,
		});
	};

	return {
		preferences,
		preferenceMap,
		updatePreference,
		deletePreference,
		isUpdating: updateMutation.isPending || deleteMutation.isPending,
		...queryResult,
		...mapQueryResult,
	};
}

/**
 * Hook for checking if a category is flexible in analytics
 */
export function useCategoryIsFlexible(categoryId: string) {
	const { preferenceMap } = useAnalyticsCategoryPreferences();

	return {
		isFlexible: preferenceMap?.[categoryId] ?? true, // Default to flexible
	};
}
