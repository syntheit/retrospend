"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	DEFAULT_LAYOUT,
	WIDGET_REGISTRY,
	type LayoutItem,
	type WidgetSize,
} from "~/app/(dashboard)/dashboard/_lib/widget-registry";
import type { DashboardSettings } from "~/server/services/user-settings";
import { usePageSettings } from "./use-page-settings";

function parseLayout(settings: unknown): LayoutItem[] {
	const dashSettings = settings as DashboardSettings | undefined;
	if (!dashSettings || dashSettings.version !== 2 || !dashSettings.layout) {
		return DEFAULT_LAYOUT;
	}

	// Ensure all registered widgets are in the layout
	const existingIds = new Set(dashSettings.layout.map((item) => item.id));
	const missingWidgets = DEFAULT_LAYOUT.filter(
		(item) => !existingIds.has(item.id) && WIDGET_REGISTRY[item.id],
	);

	if (missingWidgets.length === 0) {
		return dashSettings.layout;
	}

	const maxOrder = Math.max(...dashSettings.layout.map((item) => item.order));
	return [
		...dashSettings.layout,
		...missingWidgets.map((item, i) => ({
			...item,
			visible: false,
			order: maxOrder + 1 + i,
		})),
	];
}

export function useDashboardLayout() {
	const { settings, updateSettings, isUpdating, ...queryResult } =
		usePageSettings("DASHBOARD");

	// Local state for optimistic updates — UI reads from here, not from server
	const [localLayout, setLocalLayout] = useState<LayoutItem[] | null>(null);
	const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const hasInitialized = useRef(false);

	// Sync server settings into local state on first load
	useEffect(() => {
		if (settings && !hasInitialized.current) {
			hasInitialized.current = true;
			setLocalLayout(parseLayout(settings));
		}
	}, [settings]);

	const layout = localLayout ?? parseLayout(settings);

	const visibleWidgets = useMemo(
		() =>
			layout
				.filter((item) => item.visible && WIDGET_REGISTRY[item.id])
				.sort((a, b) => a.order - b.order),
		[layout],
	);

	const hiddenWidgets = useMemo(
		() =>
			layout
				.filter((item) => !item.visible && WIDGET_REGISTRY[item.id])
				.sort((a, b) => a.order - b.order),
		[layout],
	);

	const applyLayout = useCallback(
		(newLayout: LayoutItem[]) => {
			// Update local state immediately (optimistic)
			setLocalLayout(newLayout);

			// Debounced save to server
			if (saveTimerRef.current) {
				clearTimeout(saveTimerRef.current);
			}
			saveTimerRef.current = setTimeout(() => {
				void updateSettings({
					version: 2,
					layout: newLayout,
				} as DashboardSettings);
			}, 800);
		},
		[updateSettings],
	);

	const reorder = useCallback(
		(activeId: string, overId: string) => {
			const oldIndex = layout.findIndex((item) => item.id === activeId);
			const newIndex = layout.findIndex((item) => item.id === overId);
			if (oldIndex === -1 || newIndex === -1) return;

			const newLayout = [...layout];
			const [moved] = newLayout.splice(oldIndex, 1);
			newLayout.splice(newIndex, 0, moved!);
			const reindexed = newLayout.map((item, i) => ({ ...item, order: i }));
			applyLayout(reindexed);
		},
		[layout, applyLayout],
	);

	const toggleVisibility = useCallback(
		(widgetId: string) => {
			const newLayout = layout.map((item) =>
				item.id === widgetId ? { ...item, visible: !item.visible } : item,
			);
			applyLayout(newLayout);
		},
		[layout, applyLayout],
	);

	const setSize = useCallback(
		(widgetId: string, size: WidgetSize) => {
			const definition = WIDGET_REGISTRY[widgetId];
			if (!definition) return;

			const sizeOrder: Record<WidgetSize, number> = { xs: 0, sm: 1, md: 2, lg: 3 };
			const effectiveSize =
				sizeOrder[size] < sizeOrder[definition.minSize]
					? definition.minSize
					: size;

			const newLayout = layout.map((item) =>
				item.id === widgetId ? { ...item, size: effectiveSize } : item,
			);
			applyLayout(newLayout);
		},
		[layout, applyLayout],
	);

	const addWidget = useCallback(
		(widgetId: string) => {
			const visibleItems = layout.filter((item) => item.visible);
			const insertAfterOrder =
				visibleItems.length > 0
					? Math.max(...visibleItems.map((item) => item.order))
					: -1;

			let newLayout = layout.map((item) => {
				if (item.id === widgetId) {
					return { ...item, visible: true, order: insertAfterOrder + 0.5 };
				}
				return item;
			});

			// If widget wasn't in layout, add it
			if (!newLayout.find((item) => item.id === widgetId)) {
				const definition = WIDGET_REGISTRY[widgetId];
				if (!definition) return;
				newLayout.push({
					id: widgetId,
					visible: true,
					size: definition.defaultSize,
					order: insertAfterOrder + 1,
				});
			}

			const sorted = newLayout.sort((a, b) => a.order - b.order);
			const reindexed = sorted.map((item, i) => ({ ...item, order: i }));
			applyLayout(reindexed);
		},
		[layout, applyLayout],
	);

	const removeWidget = useCallback(
		(widgetId: string) => {
			toggleVisibility(widgetId);
		},
		[toggleVisibility],
	);

	const resetToDefault = useCallback(() => {
		applyLayout(DEFAULT_LAYOUT);
	}, [applyLayout]);

	return {
		layout,
		visibleWidgets,
		hiddenWidgets,
		isLoading: queryResult.isLoading,
		isSaving: isUpdating,
		actions: {
			reorder,
			toggleVisibility,
			setSize,
			addWidget,
			removeWidget,
			resetToDefault,
		},
	};
}
