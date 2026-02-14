"use client";

import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageContent } from "~/components/page-content";
import { SiteHeader } from "~/components/site-header";
import { Button } from "~/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Skeleton } from "~/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { NetWorthSummary } from "~/components/wealth/net-worth-summary";
import { WealthAllocationChart } from "~/components/wealth/wealth-allocation-chart";
import { WealthCurrencyExposure } from "~/components/wealth/wealth-currency-exposure";
import { WealthDataTable } from "~/components/wealth/wealth-data-table";
import { AssetDialog } from "~/components/wealth/asset-dialog";
import { WealthHistoryChart } from "~/components/wealth/wealth-history-chart";
import { useWealthDashboard } from "~/hooks/use-wealth-dashboard";
import { AssetType } from "~/lib/db-enums";
import { api } from "~/trpc/react";

export default function WealthPage() {
	const { data: settings } = api.settings.getGeneral.useQuery();
	const homeCurrency = settings?.homeCurrency ?? "USD";
	const utils = api.useUtils();

	const { data: dashboardData, isLoading } = api.wealth.getDashboard.useQuery({
		currency: homeCurrency,
	});

	const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(
		new Set(),
	);
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);

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

	const handleDeleteSelected = () => {
		setShowDeleteDialog(true);
	};

	const confirmDeleteSelected = async () => {
		await Promise.all(
			Array.from(selectedAssetIds).map((id) => deleteAsset.mutateAsync({ id })),
		);
		setShowDeleteDialog(false);
	};

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
					<div className="flex h-64 items-center justify-center">
						<p className="text-muted-foreground">Failed to load wealth data</p>
					</div>
				</PageContent>
			</>
		);
	}

	return (
		<>
			<SiteHeader
				actions={
					!isSelectionMode && (
						<AssetDialog
							trigger={
								<Button className="h-8" size="sm">
									<Plus className="mr-2 h-4 w-4" />
									Add Asset
								</Button>
							}
						/>
					)
				}
				title="Wealth"
			/>
			<PageContent>
				<div className="space-y-6">

					{/* Summary Cards */}
					<NetWorthSummary
						homeCurrency={homeCurrency}
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
								onTimeRangeChange={filters.setTimeRange}
								timeRange={filters.timeRange}
							/>
						</div>
						<div className="lg:col-span-3">
							<WealthAllocationChart data={allocationChartData} />
						</div>
					</div>

					<div className="grid gap-6 lg:grid-cols-7">
						<div className="min-w-0 space-y-4 lg:col-span-5">
							<div className="flex flex-col gap-3 sm:flex-row">
								<Input
									className="h-8 w-full sm:w-48 lg:w-64"
									onChange={(e) => filters.setSearch(e.target.value)}
									placeholder="Search assets..."
									value={filters.search}
								/>

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
							</div>

							<WealthDataTable
								data={filteredData}
								homeCurrency={homeCurrency}
								onDeleteSelected={handleDeleteSelected}
								onSelectionChange={setSelectedAssetIds}
								selectedRows={selectedAssetIds}
								totalNetWorth={stats.netWorth}
							/>
						</div>

						{hasMultipleCurrencies && (
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

			{/* Delete Confirmation Dialog */}
			<Dialog onOpenChange={setShowDeleteDialog} open={showDeleteDialog}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Assets</DialogTitle>
						<DialogDescription>
							Are you sure you want to delete {selectedAssetIds.size} asset
							{selectedAssetIds.size !== 1 ? "s" : ""}? This action cannot be
							undone and will affect your net worth calculations.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							disabled={deleteAsset.isPending}
							onClick={() => setShowDeleteDialog(false)}
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							disabled={deleteAsset.isPending}
							onClick={confirmDeleteSelected}
							variant="destructive"
						>
							{deleteAsset.isPending ? "Deleting..." : "Delete"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
