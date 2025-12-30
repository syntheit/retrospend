"use client";

import { PageContent } from "~/components/page-content";
import { SiteHeader } from "~/components/site-header";
import { Skeleton } from "~/components/ui/skeleton";
import { WealthAllocationChart } from "~/components/wealth/wealth-allocation-chart";
import { WealthAssetsTable } from "~/components/wealth/wealth-assets-table";
import { WealthCurrencyExposure } from "~/components/wealth/wealth-currency-exposure";
import { WealthHeader } from "~/components/wealth/wealth-header";
import { WealthHistoryChart } from "~/components/wealth/wealth-history-chart";
import { normalizeAssets } from "~/lib/utils";
import { api } from "~/trpc/react";

export default function WealthPage() {
	const { data: dashboardData, isLoading } = api.wealth.getDashboard.useQuery();

	const normalizedAssets = dashboardData
		? normalizeAssets(
				dashboardData.assets.map((asset) => ({
					...asset,
					exchangeRate:
						asset.exchangeRate instanceof Object &&
						"toNumber" in asset.exchangeRate
							? asset.exchangeRate.toNumber()
							: asset.exchangeRate,
				})),
			)
		: [];

	if (isLoading) {
		return (
			<>
				<SiteHeader title="Wealth" />
				<PageContent>
					<div className="space-y-4 lg:space-y-6">
						<Skeleton className="h-32 w-full" />

						<div className="grid gap-4 lg:grid-cols-7">
							<div className="lg:col-span-4">
								<Skeleton className="h-80 w-full" />
							</div>
							<div className="lg:col-span-3">
								<Skeleton className="h-80 w-full" />
							</div>
						</div>

						<div className="grid gap-4 lg:grid-cols-7">
							<div className="lg:col-span-5">
								<Skeleton className="h-96 w-full" />
							</div>
							<div className="lg:col-span-2">
								<Skeleton className="h-96 w-full" />
							</div>
						</div>
					</div>
				</PageContent>
			</>
		);
	}

	if (!dashboardData) {
		return (
			<>
				<SiteHeader title="Wealth" />
				<PageContent>
					<div className="flex h-64 items-center justify-center">
						<p className="text-muted-foreground">Failed to load wealth data</p>
					</div>
				</PageContent>
			</>
		);
	}

	return (
		<>
			<SiteHeader title="Wealth" />
			<PageContent>
				<div className="space-y-4 lg:space-y-6">
					<WealthHeader totalNetWorth={dashboardData.totalNetWorth} />

					<div className="grid gap-4 lg:grid-cols-7">
						<div className="lg:col-span-4">
							<WealthHistoryChart data={dashboardData.history} />
						</div>
						<div className="lg:col-span-3">
							<WealthAllocationChart assets={normalizedAssets} />
						</div>
					</div>

					<div className="grid gap-4 lg:grid-cols-7">
						<div className="lg:col-span-5">
							<WealthAssetsTable assets={normalizedAssets} />
						</div>
						{new Set(normalizedAssets.map((asset) => asset.currency)).size >
							1 && (
							<div className="lg:col-span-2">
								<WealthCurrencyExposure
									assets={normalizedAssets}
									totalNetWorth={dashboardData.totalNetWorth}
								/>
							</div>
						)}
					</div>
				</div>
			</PageContent>
		</>
	);
}
