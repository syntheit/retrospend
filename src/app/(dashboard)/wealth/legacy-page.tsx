"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { AlertTriangle, Eye, EyeOff, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageContent } from "~/components/page-content";
import { SiteHeader } from "~/components/site-header";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
import { ConfirmationDialog } from "~/components/ui/confirmation-dialog";
import { Skeleton } from "~/components/ui/skeleton";
import { ExpandableSearch } from "~/components/table-search";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { AssetDialog } from "~/components/wealth/asset-dialog";
import { ClosedAccounts } from "~/components/wealth/closed-accounts";
import { NetWorthSummary } from "~/components/wealth/net-worth-summary";
import { WealthDataTable } from "~/components/wealth/wealth-data-table";
import { WealthPortfolioBreakdown } from "~/components/wealth/wealth-portfolio-breakdown";
const WealthHistoryChart = dynamic(
	() => import("~/components/wealth/wealth-history-chart").then((m) => m.WealthHistoryChart),
	{ ssr: false, loading: () => <Skeleton className="h-[300px] w-full rounded-xl" /> },
);
import { useIsMobile } from "~/hooks/use-mobile";
import { useSettings } from "~/hooks/use-settings";
import { useWealthDashboard } from "~/hooks/use-wealth-dashboard";
import { AssetType } from "~/lib/db-enums";
import { api } from "~/trpc/react";

export default function WealthPage() {
	const t = useTranslations("wealth");
	const isMobile = useIsMobile();
	const { data: settings } = useSettings();
	const homeCurrency = settings?.homeCurrency ?? "USD";
	const utils = api.useUtils();

	const { data: dashboardData, isLoading } = api.wealth.getDashboard.useQuery({
		currency: homeCurrency,
	});

	const { data: runwayData } = api.wealth.getRunwayStats.useQuery({
		currency: homeCurrency,
	});

	const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(
		new Set(),
	);
	const [showCloseDialog, setShowCloseDialog] = useState(false);
	const [pendingCloseIds, setPendingCloseIds] = useState<Set<string> | null>(
		null,
	);
	const [pendingPermanentDelete, setPendingPermanentDelete] = useState<{
		id: string;
		name: string;
	} | null>(null);
	const [isPrivacyMode, setIsPrivacyMode] = useState(false);

	useEffect(() => {
		if (settings?.defaultPrivacyMode !== undefined) {
			setIsPrivacyMode(settings.defaultPrivacyMode);
		}
	}, [settings?.defaultPrivacyMode]);

	const {
		stats,
		filteredData,
		filters,
		normalizedAssets,
		historyChartData,
		allocationChartData,
	} = useWealthDashboard({
		rawAssets: dashboardData?.assets,
		rawHistory: dashboardData?.history,
		isLoading,
		homeCurrency,
		netWorth30DaysAgo: dashboardData?.netWorth30DaysAgo,
	});

	const closeAsset = api.wealth.closeAsset.useMutation({
		onSuccess: () => {
			setSelectedAssetIds(new Set()); // Clear selection on close
			void utils.wealth.getDashboard.invalidate();
		},
		onError: (error) => {
			toast.error(error.message);
		},
	});

	const reopenAsset = api.wealth.reopenAsset.useMutation({
		onSuccess: () => {
			toast.success(t("accountReopened"));
			void utils.wealth.getDashboard.invalidate();
		},
		onError: (error) => {
			toast.error(error.message);
		},
	});

	const deleteAssetPermanently = api.wealth.deleteAssetPermanently.useMutation({
		onSuccess: () => {
			toast.success(t("assetDeletedSingle"));
			setPendingPermanentDelete(null);
			setSelectedAssetIds(new Set());
			void utils.wealth.getDashboard.invalidate();
		},
		onError: (error) => {
			toast.error(error.message);
		},
	});

	const hasMultipleCurrencies = useMemo(
		() => new Set(normalizedAssets.map((asset) => asset.currency)).size > 1,
		[normalizedAssets],
	);

	const handleCloseSelected = (ids?: Set<string>) => {
		setPendingCloseIds(ids ?? selectedAssetIds);
		setShowCloseDialog(true);
	};

	const confirmCloseSelected = async () => {
		const idsToClose = pendingCloseIds ?? selectedAssetIds;
		await Promise.all(
			Array.from(idsToClose).map((id) => closeAsset.mutateAsync({ id })),
		);
		toast.success(idsToClose.size > 1 ? t("accountsClosed") : t("accountClosed"));
		setPendingCloseIds(null);
		setShowCloseDialog(false);
	};

	const handleDeletePermanently = (id: string) => {
		const asset = normalizedAssets.find((a) => a.id === id);
		setPendingPermanentDelete({ id, name: asset?.name ?? t("thisAsset") });
	};

	const columnVisibility: import("@tanstack/react-table").ColumnVisibilityState =
		isMobile ? { select: false, allocation: false, balanceInUSD: false } : {};

	const isSelectionMode = selectedAssetIds.size > 0;

	if (isLoading) {
		return (
			<>
				<SiteHeader
					actions={
						<div className="flex gap-2">
							<Skeleton className="h-8 w-24" />
						</div>
					}
					title={t("title")}
				/>
				<PageContent>
					<div className="space-y-6">
						<div className="grid gap-4 md:grid-cols-3">
							<Skeleton className="h-24 w-full" />
							<Skeleton className="h-24 w-full" />
							<Skeleton className="h-24 w-full" />
						</div>

						<div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
							<Skeleton className="h-80 w-full lg:col-span-7" />
							<Skeleton className="h-80 w-full lg:col-span-5 rounded-xl" />
						</div>

						<Skeleton className="h-96 w-full" />
					</div>
				</PageContent>
			</>
		);
	}

	if (!dashboardData) {
		return (
			<>
				<SiteHeader
					actions={
						<AssetDialog
							trigger={
								<Button className="h-8" size="sm">
									<Plus className="mr-2 h-4 w-4" />
									{t("addAsset")}
								</Button>
							}
						/>
					}
					title={t("title")}
				/>
				<PageContent>
					<EmptyState
						description={t("failedDescription")}
						icon={AlertTriangle}
						title={t("failedToLoad")}
					/>
				</PageContent>
			</>
		);
	}

	return (
		<>
			<SiteHeader
				actions={
					<div className="flex items-center gap-2">
						<Button
							aria-label={isPrivacyMode ? t("disablePrivacy") : t("enablePrivacy")}
							className="text-muted-foreground"
							onClick={() => setIsPrivacyMode(!isPrivacyMode)}
							size="icon"
							variant="ghost"
						>
							{isPrivacyMode ? (
								<EyeOff className="h-4 w-4" />
							) : (
								<Eye className="h-4 w-4" />
							)}
						</Button>
						{!isSelectionMode && (
							<AssetDialog
								trigger={
									<Button className="h-8" size="sm">
										<Plus className="mr-2 h-4 w-4" />
										{t("addAsset")}
									</Button>
								}
							/>
						)}
					</div>
				}
				title={t("title")}
			/>
			<PageContent fill>
				<div className="flex flex-1 flex-col gap-6 min-h-0">
					{/* Summary Cards */}
					<NetWorthSummary
						averageMonthlySpend={runwayData?.averageMonthlySpend}
						homeCurrency={homeCurrency}
						isPrivacyMode={isPrivacyMode}
						netWorth30DaysAgo={stats.netWorth30DaysAgo}
						totalAssets={stats.assets}
						totalLiabilities={stats.liabilities}
						totalLiquidAssets={stats.totalLiquidAssets}
						totalNetWorth={stats.netWorth}
						weightedAPR={stats.weightedAPR}
					/>

					{dashboardData && dashboardData.missingRateCurrencies.length > 0 && (
						<p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-700 text-sm dark:text-amber-400">
							{t("missingRates", {
								currencies: dashboardData.missingRateCurrencies.join(", "),
							})}
						</p>
					)}

					{/* Chart + Portfolio side by side */}
					<div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
						<div className="lg:col-span-7">
							<WealthHistoryChart
								baseCurrency={homeCurrency}
								data={historyChartData}
								isPrivacyMode={isPrivacyMode}
								onTimeRangeChange={filters.setTimeRange}
								timeRange={filters.timeRange}
							/>
						</div>
						<div className="flex flex-col gap-4 lg:col-span-5">
							<WealthPortfolioBreakdown
								allocationData={allocationChartData}
								assets={normalizedAssets}
								className="h-full"
								hasMultipleCurrencies={hasMultipleCurrencies}
								homeCurrency={homeCurrency}
								isPrivacyMode={isPrivacyMode}
							/>
						</div>
					</div>

					<div className="flex min-h-[300px] flex-1 flex-col gap-3">
						<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
								<div className="flex items-center gap-2">
									<span className="text-muted-foreground text-sm">{t("typeFilter")}</span>
									<ToggleGroup
										onValueChange={(value) => {
											if (value) filters.setType(value as AssetType | "all");
										}}
										size="sm"
										type="single"
										value={filters.type}
									>
										<ToggleGroupItem className="cursor-pointer" value="all">
											{t("all")}
										</ToggleGroupItem>
										<ToggleGroupItem
											className="cursor-pointer"
											value={AssetType.CASH}
										>
											{t("cash")}
										</ToggleGroupItem>
										<ToggleGroupItem
											className="cursor-pointer"
											value={AssetType.INVESTMENT}
										>
											{t("invest")}
										</ToggleGroupItem>
										<ToggleGroupItem
											className="cursor-pointer"
											value={AssetType.CRYPTO}
										>
											{t("crypto")}
										</ToggleGroupItem>
										<ToggleGroupItem
											className="cursor-pointer"
											value={AssetType.REAL_ESTATE}
										>
											{t("realEstate")}
										</ToggleGroupItem>
									</ToggleGroup>
								</div>

								<div className="flex items-center gap-2">
									<span className="text-muted-foreground text-sm">
										{t("liquidityFilter")}
									</span>
									<ToggleGroup
										onValueChange={(value) => {
											if (value)
												filters.setLiquidity(
													value as "all" | "liquid" | "illiquid",
												);
										}}
										size="sm"
										type="single"
										value={filters.liquidity}
									>
										<ToggleGroupItem className="cursor-pointer" value="all">
											{t("all")}
										</ToggleGroupItem>
										<ToggleGroupItem className="cursor-pointer" value="liquid">
											{t("liquid")}
										</ToggleGroupItem>
										<ToggleGroupItem
											className="cursor-pointer"
											value="illiquid"
										>
											{t("illiquid")}
										</ToggleGroupItem>
									</ToggleGroup>
								</div>

								<ExpandableSearch
									onChange={filters.setSearch}
									placeholder={t("searchPlaceholder")}
									value={filters.search}
									slashFocus
								/>
							</div>

						{/* Assets table — full width */}
						<WealthDataTable
							columnVisibility={columnVisibility}
							data={filteredData}
							fillHeight
							homeCurrency={homeCurrency}
							isPrivacyMode={isPrivacyMode}
							onCloseSelected={handleCloseSelected}
							onDeletePermanently={handleDeletePermanently}
							onSelectionChange={setSelectedAssetIds}
							selectedRows={selectedAssetIds}
							totalAssets={stats.assets}
						/>

						<ClosedAccounts
							accounts={dashboardData.closedAssets}
							onDeletePermanently={(account) =>
								setPendingPermanentDelete({ id: account.id, name: account.name })
							}
							onReopen={(id) => reopenAsset.mutate({ id })}
							pendingId={reopenAsset.isPending ? reopenAsset.variables?.id : null}
						/>
					</div>
				</div>
			</PageContent>

			{/* Close Account Confirmation Dialog */}
			<Dialog onOpenChange={(open) => {
					setShowCloseDialog(open);
					if (!open) setPendingCloseIds(null);
				}} open={showCloseDialog}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{(pendingCloseIds ?? selectedAssetIds).size !== 1 ? t("closeAccounts") : t("closeAccount")}</DialogTitle>
						<DialogDescription>{t("closeAccountDescription")}</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							disabled={closeAsset.isPending}
							onClick={() => {
								setShowCloseDialog(false);
								setPendingCloseIds(null);
							}}
							variant="ghost"
						>
							{t("cancel")}
						</Button>
						<Button
							disabled={closeAsset.isPending}
							onClick={confirmCloseSelected}
						>
							{closeAsset.isPending
								? t("closing")
								: (pendingCloseIds ?? selectedAssetIds).size !== 1
									? t("closeAccounts")
									: t("closeAccount")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Permanent Delete Confirmation Dialog */}
			<ConfirmationDialog
				cancelLabel={t("cancel")}
				confirmLabel={t("deletePermanently")}
				description={t("deletePermanentlyDescription", {
					name: pendingPermanentDelete?.name ?? t("thisAsset"),
				})}
				isLoading={deleteAssetPermanently.isPending}
				onConfirm={() => {
					if (pendingPermanentDelete) {
						deleteAssetPermanently.mutate({ id: pendingPermanentDelete.id });
					}
				}}
				onOpenChange={(open) => {
					if (!open) setPendingPermanentDelete(null);
				}}
				open={pendingPermanentDelete !== null}
				title={t("deletePermanently")}
				variant="destructive"
			/>
		</>
	);
}
