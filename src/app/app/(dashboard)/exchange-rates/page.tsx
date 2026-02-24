"use client";

import { IconRefresh } from "@tabler/icons-react";
import { format } from "date-fns";
import { ExchangeRatesTable } from "~/components/exchange-rates-table";
import { PageContent } from "~/components/page-content";
import { SiteHeader } from "~/components/site-header";
import { Button } from "~/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { useExchangeRatesController } from "~/hooks/use-exchange-rates-controller";
import { cn } from "~/lib/utils";

function PageLayout({ children }: { children: React.ReactNode }) {
	return (
		<>
			<SiteHeader title="Exchange Rates" />
			<PageContent>{children}</PageContent>
		</>
	);
}

export default function Page() {
	const {
		rates,
		favoriteRates,
		lastSync,
		isLoading,
		isFavoritesLoading,
		isSyncing,
		error,
		favoriteRatesError,
		viewState,
		actions,
		isAdmin,
	} = useExchangeRatesController();

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
				<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
					<div className="text-muted-foreground text-sm">
						{lastSync ? (
							<>
								Last updated {format(lastSync, "MMMM dd, yyyy 'at' HH:mm")}
								{" • "}
								Rates sync daily.
							</>
						) : (
							"Rates sync daily."
						)}
					</div>
					{isAdmin && (
						<Button
							className="gap-2 self-start sm:self-auto"
							disabled={isSyncing}
							onClick={actions.syncNow}
							size="sm"
							variant="outline"
						>
							<IconRefresh
								className={cn("size-4", isSyncing && "animate-spin")}
							/>
							{isSyncing ? "Syncing..." : "Sync Now"}
						</Button>
					)}
				</div>
				<Tabs
					className="space-y-4"
					onValueChange={(value) =>
						viewState.setActiveTab(value as "favorites" | "all")
					}
					value={viewState.activeTab}
				>
					<TabsList>
						<TabsTrigger value="favorites">Favorites</TabsTrigger>
						<TabsTrigger value="all">All Currencies</TabsTrigger>
					</TabsList>
					<TabsContent value="favorites">
						{isFavoritesLoading ? (
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
								onReorder={actions.reorder}
								onToggleFavorite={actions.toggleFavorite}
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
							data={rates}
							onToggleFavorite={actions.toggleFavorite}
						/>
					</TabsContent>
				</Tabs>
			</div>
		</PageLayout>
	);
}
