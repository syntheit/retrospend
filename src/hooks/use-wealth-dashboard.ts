"use client";

import { useMemo, useState } from "react";
import type { Asset } from "~/components/wealth/wealth-table-columns";
import { parseDateOnly } from "~/lib/date";
import type { AssetType } from "~/lib/db-enums";
import { normalizeAssets, toNumber } from "~/lib/utils";
import {
	ASSET_COLORS,
	ASSET_LABELS,
	DEFAULT_CURRENCY,
	TIME_RANGES,
	type TimeRangeValue,
} from "~/lib/wealth-constants";

export type WealthCategory = "all" | "asset" | "liability";

export interface HistoryPoint {
	date: string;
	amount: number;
	assets: number;
	liabilities: number;
}

export interface AllocationSegment {
	type: string;
	label: string;
	value: number;
	percentage: number;
	fill: string;
}

interface UseWealthDashboardProps {
	rawAssets: Asset[] | undefined;
	rawHistory: HistoryPoint[] | undefined;
	isLoading: boolean;
	homeCurrency: string;
}

/**
 * useWealthDashboard - Controller hook for the wealth page.
 * Extracts business logic, filtering, and stats calculation from the view.
 */
export function useWealthDashboard({
	rawAssets,
	rawHistory,
	isLoading,
	homeCurrency = DEFAULT_CURRENCY,
}: UseWealthDashboardProps) {
	// Filter State
	const [search, setSearch] = useState("");
	const [type, setType] = useState<AssetType | "all">("all");
	const [category, setCategory] = useState<WealthCategory>("all");
	const [liquidity, setLiquidity] = useState<"all" | "liquid" | "illiquid">(
		"all",
	);
	const [timeRange, setTimeRange] = useState<TimeRangeValue>("12M");

	// 1. Normalize raw assets from TRPC
	const normalizedAssets = useMemo(() => {
		if (!rawAssets) return [] as Asset[];
		return normalizeAssets(
			rawAssets.map((asset) => ({
				...asset,
				exchangeRate: toNumber(asset.exchangeRate) ?? null,
			})),
		) as Asset[];
	}, [rawAssets]);

	// 2. Filter data based on active filters
	const filteredData = useMemo(() => {
		return normalizedAssets.filter((asset) => {
			// Search filter
			if (search && !asset.name.toLowerCase().includes(search.toLowerCase())) {
				return false;
			}

			// Category filter (Asset vs Liability)
			const isLiability = asset.type.startsWith("LIABILITY_");
			if (category === "asset" && isLiability) return false;
			if (category === "liability" && !isLiability) return false;

			// Granular type filter
			if (type !== "all" && asset.type !== type) return false;

			// Liquidity filter
			if (liquidity === "liquid" && !asset.isLiquid) return false;
			if (liquidity === "illiquid" && asset.isLiquid) return false;

			return true;
		});
	}, [normalizedAssets, search, category, type, liquidity]);

	// 3. Calculate statistics
	const stats = useMemo(() => {
		let totalAssets = 0;
		let totalLiabilities = 0;
		let totalLiquidAssets = 0;
		let weightedAPRSum = 0;
		let totalLiabilityBalanceForAPR = 0;

		filteredData.forEach((asset) => {
			const isLiability = asset.type.startsWith("LIABILITY_");
			const value = asset.balanceInTargetCurrency;
			const usdValue = asset.balanceInUSD;
			const interestRate = toNumber(asset.interestRate);

			if (isLiability) {
				totalLiabilities += value;
				totalLiabilityBalanceForAPR += usdValue;
				if (interestRate && usdValue > 0) {
					weightedAPRSum += interestRate * usdValue;
				}
			} else {
				totalAssets += value;
				if (asset.isLiquid) {
					totalLiquidAssets += value;
				}
			}
		});

		const weightedAPR =
			totalLiabilityBalanceForAPR > 0
				? weightedAPRSum / totalLiabilityBalanceForAPR
				: 0;

		return {
			assets: totalAssets,
			liabilities: totalLiabilities,
			netWorth: totalAssets - totalLiabilities,
			totalLiquidAssets,
			weightedAPR,
		};
	}, [filteredData]);

	// 4. Selectors for Charts
	const historyChartData = useMemo(() => {
		if (!rawHistory) return [];

		const sorted = [...rawHistory].sort(
			(a, b) =>
				parseDateOnly(a.date).getTime() - parseDateOnly(b.date).getTime(),
		);

		const activeRange = TIME_RANGES.find((r) => r.value === timeRange);
		if (!activeRange || activeRange.value === "all" || !activeRange.months) {
			return sorted;
		}

		const now = new Date();
		const cutoff = new Date(
			now.getFullYear(),
			now.getMonth() - activeRange.months,
			now.getDate(),
		);

		return sorted.filter((item) => parseDateOnly(item.date) >= cutoff);
	}, [rawHistory, timeRange]);

	const allocationChartData = useMemo(() => {
		const allocation = normalizedAssets.reduce(
			(acc, curr) => {
				acc[curr.type] = (acc[curr.type] || 0) + curr.balanceInTargetCurrency;
				return acc;
			},
			{} as Record<string, number>,
		);

		const total = Object.values(allocation).reduce(
			(sum, value) => sum + value,
			0,
		);

		if (total === 0) return [];

		const threshold = total * 0.05;
		let otherValue = 0;
		const segments: AllocationSegment[] = [];

		Object.entries(allocation)
			.filter(([, value]) => value > 0)
			.forEach(([type, value]) => {
				if (value < threshold) {
					otherValue += value;
				} else {
					segments.push({
						type,
						label: ASSET_LABELS[type] || type.replace("LIABILITY_", ""),
						value,
						percentage: (value / total) * 100,
						fill: ASSET_COLORS[type] || "var(--chart-5)",
					});
				}
			});

		if (otherValue > 0) {
			segments.push({
				type: "Other",
				label: "Other",
				value: otherValue,
				percentage: (otherValue / total) * 100,
				fill: ASSET_COLORS.OTHER ?? "var(--chart-5)",
			});
		}

		return segments.sort((a, b) => b.value - a.value);
	}, [normalizedAssets]);

	return {
		stats,
		filteredData,
		historyChartData,
		allocationChartData,
		homeCurrency,
		filters: {
			search,
			setSearch,
			type,
			setType,
			category,
			setCategory,
			liquidity,
			setLiquidity,
			timeRange,
			setTimeRange,
		},
		isLoading,
		normalizedAssets,
	};
}
