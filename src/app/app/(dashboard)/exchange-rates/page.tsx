"use client";

import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ExchangeRatesTable } from "~/components/exchange-rates-table";
import { PageContent } from "~/components/page-content";
import { SiteHeader } from "~/components/site-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useSession } from "~/hooks/use-session";
import { api } from "~/trpc/react";

export default function Page() {
	const {
		data: exchangeRates,
		isLoading,
		error,
	} = api.exchangeRate.getAllRates.useQuery();
	const { data: lastSync } = api.exchangeRate.getLastSync.useQuery();
	const { data: session } = useSession();

	const {
		data: favoriteExchangeRates,
		error: favoriteRatesError,
		isLoading: favoritesLoading,
		refetch: refetchFavoriteRates,
	} = api.user.getFavoriteExchangeRates.useQuery(undefined, {
		enabled: Boolean(session?.user),
	});

	const reorderFavoritesMutation = api.user.reorderFavorites.useMutation({
		onSuccess: () => {
			void refetchFavoriteRates();
		},
	});

	const toggleFavoriteMutation =
		api.user.toggleFavoriteExchangeRate.useMutation({
			onSuccess: () => {
				void refetchFavoriteRates();
			},
		});

	const favoriteRateIdSet = useMemo(
		() => new Set(favoriteExchangeRates?.map((f) => f.id) ?? []),
		[favoriteExchangeRates],
	);

	const ratesWithFavorites = useMemo(() => {
		if (!exchangeRates) {
			return [];
		}

		return exchangeRates.map((rate) => ({
			...rate,
			rate: Number(rate.rate),
			isFavorite: favoriteRateIdSet.has(rate.id),
		}));
	}, [exchangeRates, favoriteRateIdSet]);

	const favoriteRates = useMemo(() => {
		if (!favoriteExchangeRates) return [];
		return favoriteExchangeRates.map((f) => ({
			...f.rate,
			rate: Number(f.rate.rate),
			isFavorite: true,
			// Preserve order from getFavoriteExchangeRates which is sorted by order
		}));
	}, [favoriteExchangeRates]);

	const handleReorder = useCallback(
		(ids: string[]) => {
			// Optimistically update or just trigger mutation
			void reorderFavoritesMutation.mutateAsync({ exchangeRateIds: ids });
		},
		[reorderFavoritesMutation],
	);

	const [activeTab, setActiveTab] = useState<"favorites" | "all">("favorites");
	const [initialTabSet, setInitialTabSet] = useState(false);

	useEffect(() => {
		if (initialTabSet || favoritesLoading) {
			return;
		}

		setActiveTab(favoriteRates.length > 0 ? "favorites" : "all");
		setInitialTabSet(true);
	}, [favoriteRates.length, favoritesLoading, initialTabSet]);

	const handleToggleFavorite = useCallback(
		async (exchangeRateId: string) => {
			try {
				await toggleFavoriteMutation.mutateAsync({ exchangeRateId });
			} catch (err) {
				// Failed to toggle favorite silently
			}
		},
		[toggleFavoriteMutation],
	);

	if (isLoading) {
		return (
			<>
				<SiteHeader title="Exchange Rates" />
				<PageContent>
					<div>
						<div className="flex h-64 items-center justify-center">
							<div className="text-muted-foreground">
								Loading exchange rates...
							</div>
						</div>
					</div>
				</PageContent>
			</>
		);
	}

	if (error) {
		return (
			<>
				<SiteHeader title="Exchange Rates" />
				<PageContent>
					<div>
						<div className="flex h-64 items-center justify-center">
							<div className="text-destructive">
								Error loading exchange rates: {error.message}
							</div>
						</div>
					</div>
				</PageContent>
			</>
		);
	}

	return (
		<>
			<SiteHeader title="Exchange Rates" />
			<PageContent>
				<div className="space-y-6">
					<div className="text-muted-foreground text-sm">
						{lastSync ? (
							<>
								Last updated {format(lastSync, "MMMM dd, yyyy 'at' HH:mm")}
								{" • "}
								Exchange rates are automatically synced daily. All rates are
								relative to USD (1 USD = X units of currency).
							</>
						) : (
							"Exchange rates are automatically synced daily. All rates are relative to USD (1 USD = X units of currency)."
						)}
					</div>
					<Tabs
						className="space-y-4"
						onValueChange={(value) =>
							setActiveTab(value as "favorites" | "all")
						}
						value={activeTab}
					>
						<TabsList>
							<TabsTrigger value="favorites">Favorites</TabsTrigger>
							<TabsTrigger value="all">All Currencies</TabsTrigger>
						</TabsList>
						<TabsContent value="favorites">
							{favoritesLoading ? (
								<div className="rounded-lg border border-muted border-dashed p-6 text-center text-muted-foreground text-sm">
									Loading favorites...
								</div>
							) : favoriteRates.length === 0 ? (
								<div className="rounded-lg border border-muted border-dashed p-6 text-center text-muted-foreground text-sm">
									No favorites yet. Tap the heart icon on any currency under All
									Currencies to pin it here.
								</div>
							) : (
								<ExchangeRatesTable
									data={favoriteRates}
									isReorderable={true}
									onReorder={handleReorder}
									onToggleFavorite={handleToggleFavorite}
								/>
							)}
							{favoriteRatesError && (
								<div className="text-destructive text-sm">
									Error loading favorites: {favoriteRatesError.message}
								</div>
							)}
						</TabsContent>
						<TabsContent value="all">
							<ExchangeRatesTable
								data={ratesWithFavorites}
								onToggleFavorite={handleToggleFavorite}
							/>
						</TabsContent>
					</Tabs>
				</div>
			</PageContent>
		</>
	);
}
