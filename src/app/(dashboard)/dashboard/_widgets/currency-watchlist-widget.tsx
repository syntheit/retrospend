"use client";

import { FavoritesPanel } from "../../_components/favorites-panel";
import { useDashboardContext } from "../_lib/dashboard-context";
import type { WidgetProps } from "../_lib/widget-registry";

export default function CurrencyWatchlistWidget(_props: WidgetProps) {
	const { data, isLoading, state } = useDashboardContext();

	return (
		<FavoritesPanel
			favoriteRates={data.favoriteRates}
			favoritesLoading={isLoading.favorites}
			isUsingMockFavorites={state.isUsingMockFavorites}
		/>
	);
}
