"use client";

import type { PageSettings } from "~/server/services/user-settings";
import { api } from "~/trpc/react";
import type { Page } from "~prisma";

/** Pages with stored settings (the removed widget dashboard has none). */
export function usePageSettings<T extends Exclude<Page, "DASHBOARD">>(page: T) {
	const { data: settings, ...queryResult } =
		api.preferences.getPageSettings.useQuery({
			page,
		});

	const updateMutation = api.preferences.updatePageSettings.useMutation();

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

export function useAnalyticsCategoryPreferences() {
	const { data: preferences, ...queryResult } =
		api.preferences.getAnalyticsCategoryPreferences.useQuery();

	const { data: preferenceMap, ...mapQueryResult } =
		api.preferences.getAnalyticsCategoryPreferenceMap.useQuery();

	const updateMutation =
		api.preferences.updateAnalyticsCategoryPreference.useMutation();
	const deleteMutation =
		api.preferences.deleteAnalyticsCategoryPreference.useMutation();

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
		isLoading: queryResult.isLoading || mapQueryResult.isLoading,
		isError: queryResult.isError || mapQueryResult.isError,
		refetch: async () => {
			await Promise.all([queryResult.refetch(), mapQueryResult.refetch()]);
		},
	};
}

export function useCategoryIsFlexible(categoryId: string) {
	const { preferenceMap } = useAnalyticsCategoryPreferences();

	return {
		isFlexible: preferenceMap?.[categoryId] ?? true, // Default to flexible
	};
}
