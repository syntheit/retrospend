"use client";

import { format } from "date-fns";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CurrencyCalculator } from "~/components/currency-calculator";
import { ExchangeRatesTable } from "~/components/exchange-rates-table";
import { FavoriteCurrencyCards } from "~/components/favorite-currency-cards";
import { PageContent } from "~/components/page-content";
import { SiteHeader } from "~/components/site-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useExchangeRatesController } from "~/hooks/use-exchange-rates-controller";
import { useUserSettings } from "~/hooks/use-user-settings";

function PageLayout({ children }: { children: React.ReactNode }) {
	return (
		<>
			<SiteHeader title="Currencies" />
			<PageContent fill>{children}</PageContent>
		</>
	);
}

export default function Page() {
	const { settings } = useUserSettings();
	const homeCurrency = settings?.homeCurrency ?? "USD";
	const defaultCurrency = settings?.defaultCurrency ?? "ARS";

	const {
		fiatRates,
		cryptoRates,
		favoriteCurrencyCards,
		lastSync,
		isLoading,
		isFavoritesLoading,
		error,
		favoriteRatesError,
		viewState,
		actions,
	} = useExchangeRatesController();

	const searchParams = useSearchParams();
	const [calculatorCurrency, setCalculatorCurrency] = useState<string | null>(
		null,
	);

	// Auto-open calculator for currency passed via query param (e.g. from command palette)
	const lastHandledParam = useRef<string | null>(null);
	useEffect(() => {
		const currencyParam = searchParams.get("currency")?.toUpperCase() ?? null;
		if (currencyParam && currencyParam !== lastHandledParam.current) {
			lastHandledParam.current = currencyParam;
			// Force re-trigger even if calculator already shows this currency
			setCalculatorCurrency(null);
			setTimeout(() => setCalculatorCurrency(currencyParam), 0);
		}
	}, [searchParams]);

	const handleCurrencyClick = useCallback((currency: string) => {
		setCalculatorCurrency((prev) => {
			if (prev === currency) {
				setTimeout(() => setCalculatorCurrency(currency), 0);
				return null;
			}
			return currency;
		});
	}, []);

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
			<div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0">
				{/* Left column: tabs + table */}
				<div className="flex-1 min-w-0 flex flex-col min-h-0">
					<Tabs
						className="flex-1 min-h-0 flex flex-col"
						onValueChange={(value) =>
							viewState.setActiveTab(value as "fiat" | "crypto")
						}
						value={viewState.activeTab}
					>
						<div className="flex items-center justify-between gap-4 mb-4">
							<TabsList>
								<TabsTrigger value="fiat">Fiat</TabsTrigger>
								<TabsTrigger value="crypto">Cryptocurrency</TabsTrigger>
							</TabsList>
							<div className="text-muted-foreground text-sm shrink-0">
								{lastSync
									? `Updated ${format(lastSync, "MMM d, yyyy 'at' HH:mm")}`
									: "Rates sync daily."}
							</div>
						</div>
						<TabsContent className="flex flex-col min-h-0 flex-1 mt-0" value="fiat">
							<ExchangeRatesTable
								data={fiatRates}
								grouped
								onRowClick={handleCurrencyClick}
								onToggleFavorite={actions.toggleFavorite}
							/>
						</TabsContent>
						<TabsContent className="flex flex-col min-h-0 flex-1 mt-0" value="crypto">
							<ExchangeRatesTable
								data={cryptoRates}
								grouped
								onRowClick={handleCurrencyClick}
								onToggleFavorite={actions.toggleFavorite}
							/>
						</TabsContent>
					</Tabs>
				</div>

				{/* Right sidebar: calculator + favorites */}
				<div className="w-full lg:w-[320px] lg:flex-shrink-0 flex flex-col gap-4 min-h-0">
					<CurrencyCalculator
						defaultCurrency={defaultCurrency}
						externalCurrency={calculatorCurrency}
						homeCurrency={homeCurrency}
					/>

					<div className="flex flex-col min-h-0 flex-1">
						<div className="flex items-baseline justify-between mb-2">
							<h3 className="text-sm font-medium">Favorites</h3>
							{favoriteCurrencyCards.length > 0 && (
								<span className="text-muted-foreground text-xs">
									Drag to reorder
								</span>
							)}
						</div>
						<div className="overflow-y-auto flex-1 min-h-0">
							{isFavoritesLoading ? (
								<div className="rounded-lg border border-dashed border-muted p-4 text-center text-muted-foreground text-sm">
									Loading favorites...
								</div>
							) : (
								<FavoriteCurrencyCards
									cards={favoriteCurrencyCards}
									onCardClick={handleCurrencyClick}
									onReorder={actions.reorder}
									onUnfavorite={actions.unfavoriteCurrency}
									variant="compact"
								/>
							)}
							{favoriteRatesError && (
								<div className="text-destructive text-sm mt-2">
									Error loading favorites: {favoriteRatesError.message}
								</div>
							)}
						</div>
					</div>
				</div>
			</div>
		</PageLayout>
	);
}
