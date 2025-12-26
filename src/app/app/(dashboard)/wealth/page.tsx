import { PageContent } from "~/components/page-content";
import { SiteHeader } from "~/components/site-header";
import { WealthAllocationChart } from "~/components/wealth/wealth-allocation-chart";
import { WealthAssetsTable } from "~/components/wealth/wealth-assets-table";
import { WealthCurrencyExposure } from "~/components/wealth/wealth-currency-exposure";
import { WealthHeader } from "~/components/wealth/wealth-header";
import { WealthHistoryChart } from "~/components/wealth/wealth-history-chart";
import { normalizeAssets } from "~/lib/utils";
import { api, HydrateClient } from "~/trpc/server";

export default async function WealthPage() {
	const dashboardData = await api.wealth.getDashboard();
	const normalizedAssets = normalizeAssets(
		dashboardData.assets.map((asset) => ({
			...asset,
			exchangeRate: asset.exchangeRate instanceof Object && 'toNumber' in asset.exchangeRate
				? asset.exchangeRate.toNumber()
				: asset.exchangeRate,
		})),
	);

	return (
		<HydrateClient>
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
		</HydrateClient>
	);
}
