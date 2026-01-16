"use client";

import { format } from "date-fns";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { ExchangeRatesTable } from "~/components/exchange-rates-table";
import { PageContent } from "~/components/page-content";
import { SiteHeader } from "~/components/site-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useSession } from "~/hooks/use-session";
import { api } from "~/trpc/react";

function PageLayout({ children }: { children: React.ReactNode }) {
	return (
		<>
			<SiteHeader title="Exchange Rates" />
			<PageContent>{children}</PageContent>
		</>
	);
}

export default function Page() {
	const utils = api.useUtils();

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
	} = api.user.getFavoriteExchangeRates.useQuery(undefined, {
		enabled: Boolean(session?.user),
	});

	const reorderFavoritesMutation = api.user.reorderFavorites.useMutation({
		onSuccess: () => {
			void utils.user.getFavoriteExchangeRates.invalidate();
		},
	});

	const toggleFavoriteMutation =
		api.user.toggleFavoriteExchangeRate.useMutation({
			onSuccess: () => {
				void utils.user.getFavoriteExchangeRates.invalidate();
			},
			onError: () => {
				toast.error("Failed to update favorite");
			},
		});

	const favoriteRateIdSet = useMemo(
		() => new Set(favoriteExchangeRates?.map((f) => f.id) ?? []),
		[favoriteExchangeRates],
	);

	const ratesWithFavorites = useMemo(() => {
		if (!exchangeRates) return [];

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
		}));
	}, [favoriteExchangeRates]);

	const handleReorder = useCallback(
		(ids: string[]) => {
			reorderFavoritesMutation.mutate({ exchangeRateIds: ids });
		},
		[reorderFavoritesMutation],
	);

	const [activeTab, setActiveTab] = useState<"favorites" | "all">(
		!favoritesLoading && favoriteRates.length > 0 ? "favorites" : "all",
	);

	const handleToggleFavorite = useCallback(
		async (exchangeRateId: string) => {
			await toggleFavoriteMutation.mutateAsync({ exchangeRateId });
		},
		[toggleFavoriteMutation],
	);

	if (isLoading) {
		return (
			<PageLayout>
				<div className="flex h-64 items-center justify-center">
					<div className="text-muted-foreground">Loading exchange rates...</div>
				</div>
			</PageLayout>
		);
	}

	if (error) {
		return (
			<PageLayout>
				<div className="flex h-64 items-center justify-center">
					<div className="text-destructive">
						Error loading exchange rates: {error.message}
					</div>
				</div>
			</PageLayout>
		);
	}

	return (
		<PageLayout>
			<div className="mx-auto w-full max-w-4xl space-y-6">
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
					onValueChange={(value) => setActiveTab(value as "favorites" | "all")}
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
		</PageLayout>
	);
}
