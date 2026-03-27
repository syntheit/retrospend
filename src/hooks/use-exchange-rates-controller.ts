import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { useSession } from "~/hooks/use-session";
import { isCrypto } from "~/lib/currency-format";
import { api } from "~/trpc/react";

export interface ExchangeRateRow {
	id: string;
	date: Date;
	currency: string;
	type: string;
	rate: number;
	isFavorite: boolean;
	createdAt: Date;
	updatedAt: Date;
}

export interface FavoriteCurrencyCardData {
	currency: string;
	rateTypes: { id: string; type: string; rate: number }[];
	/** The exchange rate ID of the primary (favorited) rate */
	primaryRateId: string;
	order: number;
}

export function useExchangeRatesController() {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const utils = api.useUtils();
	const { data: session } = useSession();

	const {
		data: exchangeRates,
		isLoading: isAllRatesLoading,
		error: allRatesError,
	} = api.exchangeRate.getAllRates.useQuery(undefined, { enabled: Boolean(session?.user), staleTime: 60 * 60 * 1000 });

	const { data: lastSync } = api.exchangeRate.getLastSync.useQuery(undefined, { enabled: Boolean(session?.user) });

	const {
		data: favoriteExchangeRates,
		error: favoriteRatesError,
		isLoading: isFavoritesLoading,
	} = api.preferences.getFavoriteExchangeRates.useQuery(undefined, {
		enabled: Boolean(session?.user),
	});

	const reorderFavoritesMutation = api.preferences.reorderFavorites.useMutation(
		{
			onMutate: async ({ exchangeRateIds }) => {
				// Cancel any outgoing refetches (so they don't overwrite our optimistic update)
				await utils.preferences.getFavoriteExchangeRates.cancel();

				// Snapshot the previous value
				const previousFavorites =
					utils.preferences.getFavoriteExchangeRates.getData();

				// Optimistically update to the new value
				if (previousFavorites) {
					const idMap = new Map(previousFavorites.map((f) => [f.id, f]));
					const nextFavorites = exchangeRateIds
						.map((id) => idMap.get(id))
						.filter(Boolean) as typeof previousFavorites;

					utils.preferences.getFavoriteExchangeRates.setData(
						undefined,
						nextFavorites,
					);
				}

				return { previousFavorites };
			},
			onError: (_err, _newOrder, context) => {
				// If the mutation fails, use the context returned from onMutate to roll back
				if (context?.previousFavorites) {
					utils.preferences.getFavoriteExchangeRates.setData(
						undefined,
						context.previousFavorites,
					);
				}
				toast.error("Failed to reorder favorites");
			},
			onSettled: () => {
				// Always refetch after error or success to make sure we're in sync with the server
				void utils.preferences.getFavoriteExchangeRates.invalidate();
			},
		},
	);

	const toggleFavoriteMutation =
		api.preferences.toggleFavoriteExchangeRate.useMutation({
			onSuccess: () => {
				void utils.preferences.getFavoriteExchangeRates.invalidate();
			},
			onError: () => {
				toast.error("Failed to update favorite");
			},
		});

	const favoriteRateIdSet = useMemo(
		() => new Set(favoriteExchangeRates?.map((f) => f.id) ?? []),
		[favoriteExchangeRates],
	);

	const ratesWithFavorites = useMemo((): ExchangeRateRow[] => {
		if (!exchangeRates) return [];

		return exchangeRates.map((rate) => ({
			...rate,
			rate: Number(rate.rate),
			isFavorite: favoriteRateIdSet.has(rate.id),
		}));
	}, [exchangeRates, favoriteRateIdSet]);

	const favoriteRates = useMemo((): ExchangeRateRow[] => {
		if (!favoriteExchangeRates) return [];
		return favoriteExchangeRates.map((f) => ({
			...f.rate,
			rate: Number(f.rate.rate),
			isFavorite: true,
		}));
	}, [favoriteExchangeRates]);

	const fiatRates = useMemo(
		() => ratesWithFavorites.filter((r) => !isCrypto(r.currency)),
		[ratesWithFavorites],
	);

	const cryptoRates = useMemo(
		() => ratesWithFavorites.filter((r) => isCrypto(r.currency)),
		[ratesWithFavorites],
	);

	// Build card data for favorites: group by currency, supplement with all rate types
	const favoriteCurrencyCards = useMemo((): FavoriteCurrencyCardData[] => {
		if (!favoriteExchangeRates || !exchangeRates) return [];

		const seen = new Map<string, FavoriteCurrencyCardData>();

		for (const fav of favoriteExchangeRates) {
			const currency = fav.rate.currency;
			if (!seen.has(currency)) {
				// Find all rate types for this currency from the full rates list
				const allTypesForCurrency = exchangeRates
					.filter((r) => r.currency === currency)
					.map((r) => ({
						id: r.id,
						type: r.type,
						rate: Number(r.rate),
					}));

				seen.set(currency, {
					currency,
					rateTypes: allTypesForCurrency,
					primaryRateId: fav.id,
					order: fav.order,
				});
			}
		}

		return Array.from(seen.values());
	}, [favoriteExchangeRates, exchangeRates]);

	const activeTab =
		(searchParams.get("tab") as "fiat" | "crypto") || "fiat";

	const setActiveTab = useCallback(
		(tab: string) => {
			const params = new URLSearchParams(searchParams.toString());
			params.set("tab", tab);
			router.replace(`${pathname}?${params.toString()}`, { scroll: false });
		},
		[pathname, router, searchParams],
	);

	const handleReorder = useCallback(
		(ids: string[]) => {
			reorderFavoritesMutation.mutate({ exchangeRateIds: ids });
		},
		[reorderFavoritesMutation],
	);

	const handleToggleFavorite = useCallback(
		async (exchangeRateId: string) => {
			await toggleFavoriteMutation.mutateAsync({ exchangeRateId });
		},
		[toggleFavoriteMutation],
	);

	const handleUnfavoriteCurrency = useCallback(
		async (currency: string) => {
			if (!favoriteExchangeRates) return;
			const idsToRemove = favoriteExchangeRates
				.filter((f) => f.rate.currency === currency)
				.map((f) => f.id);

			for (const id of idsToRemove) {
				await toggleFavoriteMutation.mutateAsync({ exchangeRateId: id });
			}
		},
		[favoriteExchangeRates, toggleFavoriteMutation],
	);

	return {
		rates: ratesWithFavorites,
		fiatRates,
		cryptoRates,
		favoriteRates,
		favoriteCurrencyCards,
		favoriteRateIdSet,
		lastSync,
		isLoading: isAllRatesLoading || isFavoritesLoading,
		isFavoritesLoading,
		error: allRatesError || favoriteRatesError,
		favoriteRatesError,
		viewState: {
			activeTab,
			setActiveTab,
		},
		actions: {
			reorder: handleReorder,
			toggleFavorite: handleToggleFavorite,
			unfavoriteCurrency: handleUnfavoriteCurrency,
		},
	};
}
