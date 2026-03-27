"use client";

import dynamic from "next/dynamic";
import { AlertTriangle, Eye, EyeOff, Plus, Users } from "lucide-react";
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
import { Skeleton } from "~/components/ui/skeleton";
import { ExpandableSearch } from "~/components/table-search";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { AssetDialog } from "~/components/wealth/asset-dialog";
import { NetWorthSummary } from "~/components/wealth/net-worth-summary";
import { WealthCurrencyExposure } from "~/components/wealth/wealth-currency-exposure";
import { WealthDataTable } from "~/components/wealth/wealth-data-table";

const WealthAllocationChart = dynamic(
	() => import("~/components/wealth/wealth-allocation-chart").then((m) => m.WealthAllocationChart),
	{ ssr: false, loading: () => <Skeleton className="h-[300px] w-full rounded-xl" /> },
);
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

	const { data: sharedBalances } = api.wealth.getSharedBalances.useQuery({
		currency: homeCurrency,
	});

	const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(
		new Set(),
	);
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);
	const [pendingDeleteIds, setPendingDeleteIds] = useState<Set<string> | null>(
		null,
	);
	const [isPrivacyMode, setIsPrivacyMode] = useState(false);
	const [includeSharedInNetWorth, setIncludeSharedInNetWorth] = useState(() => {
		if (typeof window === "undefined") return true;
		const stored = localStorage.getItem("wealth:includeShared");
		return stored !== null ? stored === "true" : true;
	});

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
		sharedReceivables: sharedBalances?.receivables ?? 0,
		sharedPayables: sharedBalances?.payables ?? 0,
		includeSharedInNetWorth,
	});

	const deleteAsset = api.wealth.deleteAsset.useMutation({
		onSuccess: () => {
			toast.success("Assets deleted successfully");
			setSelectedAssetIds(new Set()); // Clear selection on delete
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

	const handleDeleteSelected = (ids?: Set<string>) => {
		setPendingDeleteIds(ids ?? selectedAssetIds);
		setShowDeleteDialog(true);
	};

	const confirmDeleteSelected = async () => {
		const idsToDelete = pendingDeleteIds ?? selectedAssetIds;
		await Promise.all(
			Array.from(idsToDelete).map((id) => deleteAsset.mutateAsync({ id })),
		);
		setPendingDeleteIds(null);
		setShowDeleteDialog(false);
	};

	const columnVisibility: import("@tanstack/react-table").VisibilityState =
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
					title="Wealth"
				/>
				<PageContent>
					<div className="space-y-6">
						<div className="grid gap-4 md:grid-cols-3">
							<Skeleton className="h-24 w-full" />
							<Skeleton className="h-24 w-full" />
							<Skeleton className="h-24 w-full" />
						</div>

						<div className="grid gap-6 lg:grid-cols-7">
							<div className="lg:col-span-4">
								<Skeleton className="h-80 w-full" />
							</div>
							<div className="lg:col-span-3">
								<Skeleton className="h-80 w-full" />
							</div>
						</div>

						<div className="grid gap-6 lg:grid-cols-7">
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
				<SiteHeader
					actions={
						<AssetDialog
							trigger={
								<Button className="h-8" size="sm">
									<Plus className="mr-2 h-4 w-4" />
									Add Asset
								</Button>
							}
						/>
					}
					title="Wealth"
				/>
				<PageContent>
					<EmptyState
						description="Something went wrong loading your wealth data. Please try refreshing the page."
						icon={AlertTriangle}
						title="Failed to Load"
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
						{(sharedBalances?.receivables ?? 0) > 0 ||
						(sharedBalances?.payables ?? 0) > 0 ? (
							<Button
								className="gap-1.5 text-xs"
								onClick={() => {
									const next = !includeSharedInNetWorth;
									setIncludeSharedInNetWorth(next);
									localStorage.setItem("wealth:includeShared", String(next));
								}}
								size="sm"
								variant={includeSharedInNetWorth ? "outline" : "ghost"}
							>
								<Users className="h-3.5 w-3.5" />
								Shared
							</Button>
						) : null}
						<Button
							aria-label={isPrivacyMode ? "Disable privacy mode" : "Enable privacy mode"}
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
										Add Asset
									</Button>
								}
							/>
						)}
					</div>
				}
				title="Wealth"
			/>
			<PageContent fill>
				<div className="flex min-h-0 flex-1 flex-col gap-6">
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

					<div className="grid gap-6 lg:grid-cols-7">
						<div className="lg:col-span-4">
							<WealthHistoryChart
								baseCurrency={homeCurrency}
								data={historyChartData}
								isPrivacyMode={isPrivacyMode}
								onTimeRangeChange={filters.setTimeRange}
								timeRange={filters.timeRange}
							/>
						</div>
						<div className="lg:col-span-3">
							<WealthAllocationChart
								data={allocationChartData}
								isPrivacyMode={isPrivacyMode}
							/>
						</div>
					</div>

					<div className="flex min-h-0 flex-1 flex-col gap-3">
						<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
								<div className="flex items-center gap-2">
									<span className="text-muted-foreground text-sm">Type:</span>
									<ToggleGroup
										onValueChange={(value) => {
											if (value) filters.setType(value as AssetType | "all");
										}}
										size="sm"
										type="single"
										value={filters.type}
									>
										<ToggleGroupItem className="cursor-pointer" value="all">
											All
										</ToggleGroupItem>
										<ToggleGroupItem
											className="cursor-pointer"
											value={AssetType.CASH}
										>
											Cash
										</ToggleGroupItem>
										<ToggleGroupItem
											className="cursor-pointer"
											value={AssetType.INVESTMENT}
										>
											Invest
										</ToggleGroupItem>
										<ToggleGroupItem
											className="cursor-pointer"
											value={AssetType.CRYPTO}
										>
											Crypto
										</ToggleGroupItem>
										<ToggleGroupItem
											className="cursor-pointer"
											value={AssetType.REAL_ESTATE}
										>
											Real Estate
										</ToggleGroupItem>
									</ToggleGroup>
								</div>

								<div className="flex items-center gap-2">
									<span className="text-muted-foreground text-sm">
										Liquidity:
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
											All
										</ToggleGroupItem>
										<ToggleGroupItem className="cursor-pointer" value="liquid">
											Liquid
										</ToggleGroupItem>
										<ToggleGroupItem
											className="cursor-pointer"
											value="illiquid"
										>
											Illiquid
										</ToggleGroupItem>
									</ToggleGroup>
								</div>

								<ExpandableSearch
									onChange={filters.setSearch}
									placeholder="Search assets..."
									value={filters.search}
								/>
							</div>

						<div className="flex min-h-0 flex-1 gap-6">
							<WealthDataTable
								columnVisibility={columnVisibility}
								fillHeight
								data={filteredData}
								homeCurrency={homeCurrency}
								isPrivacyMode={isPrivacyMode}
								onDeleteSelected={handleDeleteSelected}
								onSelectionChange={setSelectedAssetIds}
								selectedRows={selectedAssetIds}
								totalNetWorth={stats.netWorth}
							/>

							{hasMultipleCurrencies && (
								<div className="w-72 shrink-0">
									<WealthCurrencyExposure
										assets={normalizedAssets}
										isPrivacyMode={isPrivacyMode}
										totalNetWorth={dashboardData.totalNetWorth}
									/>
								</div>
							)}
						</div>
					</div>
				</div>
			</PageContent>

			{/* Delete Confirmation Dialog */}
			<Dialog onOpenChange={(open) => {
					setShowDeleteDialog(open);
					if (!open) setPendingDeleteIds(null);
				}} open={showDeleteDialog}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Asset{(pendingDeleteIds ?? selectedAssetIds).size !== 1 ? "s" : ""}</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete {(pendingDeleteIds ?? selectedAssetIds).size} asset
							{(pendingDeleteIds ?? selectedAssetIds).size !== 1 ? "s" : ""}? This action cannot be
							undone and will affect your net worth calculations.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							disabled={deleteAsset.isPending}
							onClick={() => {
								setShowDeleteDialog(false);
								setPendingDeleteIds(null);
							}}
							variant="ghost"
						>
							Cancel
						</Button>
						<Button
							disabled={deleteAsset.isPending}
							onClick={confirmDeleteSelected}
							variant="destructive"
						>
							{deleteAsset.isPending ? "Deleting..." : "Delete Assets"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
