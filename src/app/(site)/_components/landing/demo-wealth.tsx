"use client";

import { useMemo } from "react";
import { NetWorthSummary } from "~/components/wealth/net-worth-summary";
import { WealthAllocationChart } from "~/components/wealth/wealth-allocation-chart";
import { WealthDataTable } from "~/components/wealth/wealth-data-table";
import { WealthHistoryChart } from "~/components/wealth/wealth-history-chart";
import { useCurrencyConversion } from "~/hooks/use-currency-conversion";
import { api } from "~/trpc/react";
import {
	DEMO_NET_WORTH,
	DEMO_WEALTH_ALLOCATION,
	DEMO_WEALTH_ASSETS,
	generateDemoWealthHistory,
} from "./demo-data";

export function DemoWealth() {
	const historyData = useMemo(() => generateDemoWealthHistory(), []);
	const { toUSD } = useCurrencyConversion();
	const { data: brlRate } = api.exchangeRate.getRate.useQuery({
		currency: "BRL",
	});

	const assets = useMemo(() => {
		if (!brlRate) return DEMO_WEALTH_ASSETS;
		return DEMO_WEALTH_ASSETS.map((asset) => {
			if (asset.currency !== "BRL") return asset;
			const balanceInUSD = toUSD(asset.balance, "BRL", Number(brlRate.rate));
			return { ...asset, balanceInUSD, balanceInTargetCurrency: balanceInUSD };
		});
	}, [brlRate, toUSD]);

	return (
		<div className="space-y-6">
			<NetWorthSummary
				averageMonthlySpend={DEMO_NET_WORTH.averageMonthlySpend}
				homeCurrency="USD"
				netWorth30DaysAgo={DEMO_NET_WORTH.netWorth30DaysAgo}
				totalAssets={DEMO_NET_WORTH.totalAssets}
				totalLiabilities={DEMO_NET_WORTH.totalLiabilities}
				totalLiquidAssets={DEMO_NET_WORTH.totalLiquidAssets}
				totalNetWorth={DEMO_NET_WORTH.totalNetWorth}
				weightedAPR={DEMO_NET_WORTH.weightedAPR}
			/>

			<div className="grid gap-6 lg:grid-cols-7">
				<div className="lg:col-span-4">
					<WealthHistoryChart
						baseCurrency="USD"
						data={historyData}
						timeRange="12M"
					/>
				</div>
				<div className="lg:col-span-3">
					<WealthAllocationChart data={DEMO_WEALTH_ALLOCATION} />
				</div>
			</div>

			<WealthDataTable
				data={assets}
				hidePagination
				homeCurrency="USD"
				readOnly
				totalNetWorth={DEMO_NET_WORTH.totalNetWorth}
			/>
		</div>
	);
}
