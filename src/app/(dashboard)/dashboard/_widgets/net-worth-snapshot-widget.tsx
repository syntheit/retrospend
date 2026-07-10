"use client";

import { Landmark, TrendingDown, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { Skeleton } from "~/components/ui/skeleton";
import { useCurrency } from "~/hooks/use-currency";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import type { WidgetProps } from "../_lib/widget-registry";

export default function NetWorthSnapshotWidget(_props: WidgetProps) {
	const t = useTranslations("wealth");
	const { homeCurrency } = useCurrency();
	const { formatCurrency } = useCurrencyFormatter();

	const { data, isLoading } = api.wealth.getDashboard.useQuery({
		currency: homeCurrency,
	});

	const sparklineData = useMemo(() => {
		if (!data?.history) return [];
		// Take last 30 data points for sparkline
		return data.history.slice(-30).map((point) => ({
			value: point.amount,
		}));
	}, [data?.history]);

	if (isLoading) {
		return (
			<div className="space-y-3 p-1">
				<Skeleton className="h-8 w-32" />
				<Skeleton className="h-12 w-full" />
				<Skeleton className="h-4 w-24" />
			</div>
		);
	}

	if (!data || data.assets.length === 0) {
		return (
			<EmptyState
				description={t("noAssetsDescription")}
				icon={Landmark}
				title={t("noAssetsTitle")}
				action={{
					label: t("addAsset"),
					href: "/wealth",
				}}
			/>
		);
	}

	const netWorth = data.totalNetWorth ?? 0;
	const change30d = netWorth - (data.netWorth30DaysAgo ?? 0);
	const isPositive = change30d >= 0;
	const changePct = netWorth !== 0 ? (change30d / (netWorth - change30d)) * 100 : 0;

	return (
		<div className="flex flex-col gap-3 p-1">
			<div className="flex items-start justify-between">
				<div>
					<div className="font-bold text-2xl tabular-nums tracking-tight">
						{formatCurrency(netWorth, homeCurrency)}
					</div>
					<div
						className={cn(
							"flex items-center gap-1 text-xs font-medium",
							isPositive ? "text-emerald-500" : "text-rose-500",
						)}
					>
						{isPositive ? (
							<TrendingUp className="h-3 w-3" />
						) : (
							<TrendingDown className="h-3 w-3" />
						)}
						{isPositive ? "+" : ""}
						{formatCurrency(change30d, homeCurrency)} ({changePct.toFixed(1)}%)
						<span className="text-muted-foreground font-normal">30d</span>
					</div>
				</div>
				<div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted/50">
					<Landmark className="h-5 w-5 text-muted-foreground" />
				</div>
			</div>

			{sparklineData.length > 1 && (
				<div className="h-12 w-full">
					<ResponsiveContainer height="100%" width="100%">
						<AreaChart data={sparklineData}>
							<defs>
								<linearGradient id="sparkFill" x1="0" x2="0" y1="0" y2="1">
									<stop
										offset="5%"
										stopColor={isPositive ? "#10b981" : "#f43f5e"}
										stopOpacity={0.3}
									/>
									<stop
										offset="95%"
										stopColor={isPositive ? "#10b981" : "#f43f5e"}
										stopOpacity={0}
									/>
								</linearGradient>
							</defs>
							<Area
								dataKey="value"
								fill="url(#sparkFill)"
								stroke={isPositive ? "#10b981" : "#f43f5e"}
								strokeWidth={1.5}
								type="monotone"
							/>
						</AreaChart>
					</ResponsiveContainer>
				</div>
			)}

			<Button asChild className="w-full" size="sm" variant="ghost">
				<Link href="/wealth">{t("assetsNoun")}</Link>
			</Button>
		</div>
	);
}
