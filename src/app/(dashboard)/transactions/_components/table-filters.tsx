"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { DatePicker } from "~/components/ui/date-picker";
import { MonthStepper } from "~/components/date/MonthStepper";
import { useCategoryName } from "~/hooks/use-category-name";
import { getCategoryIcon } from "~/lib/category-icons";
import type { DateRangeState, AmountRange } from "~/hooks/use-table-filters";

function getMonthNames(t: ReturnType<typeof useTranslations<"ui">>): string[] {
	return [
		t("january"), t("february"), t("march"), t("april"),
		t("may"), t("june"), t("july"), t("august"),
		t("september"), t("october"), t("november"), t("december"),
	];
}

function getShortMonthNames(t: ReturnType<typeof useTranslations<"ui">>): string[] {
	return [
		t("janShort"), t("febShort"), t("marShort"), t("aprShort"),
		t("mayShort"), t("junShort"), t("julShort"), t("augShort"),
		t("sepShort"), t("octShort"), t("novShort"), t("decShort"),
	];
}

type TypeFilter = "all" | "personal" | "shared";
type ExcludeFilter = "all" | "included" | "excluded";

function getDatePresets(t: ReturnType<typeof useTranslations<"tableFilters">>): {
	label: string;
	key: string;
	getRange: () => { from: Date; to: Date };
}[] {
	const today = new Date();
	today.setHours(23, 59, 59, 999);

	return [
		{
			label: t("thisMonth"),
			key: "month",
			getRange: () => {
				const from = new Date(today.getFullYear(), today.getMonth(), 1);
				return { from, to: today };
			},
		},
		{
			label: t("last7Days"),
			key: "7d",
			getRange: () => {
				const from = new Date(today);
				from.setDate(from.getDate() - 6);
				from.setHours(0, 0, 0, 0);
				return { from, to: today };
			},
		},
		{
			label: t("last30Days"),
			key: "30d",
			getRange: () => {
				const from = new Date(today);
				from.setDate(from.getDate() - 29);
				from.setHours(0, 0, 0, 0);
				return { from, to: today };
			},
		},
		{
			label: t("thisQuarter"),
			key: "quarter",
			getRange: () => {
				const quarterMonth = Math.floor(today.getMonth() / 3) * 3;
				const from = new Date(today.getFullYear(), quarterMonth, 1);
				return { from, to: today };
			},
		},
		{
			label: t("yearToDate"),
			key: "ytd",
			getRange: () => {
				const from = new Date(today.getFullYear(), 0, 1);
				return { from, to: today };
			},
		},
	];
}

function formatDateForInput(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

export interface TableFiltersProps {
	// Type filter
	typeFilter: TypeFilter;
	setTypeFilter: (type: TypeFilter) => void;

	// Whether the user has any shared expenses at all
	hasSharedExpenses?: boolean;

	// Exclusion filter
	excludeFilter: ExcludeFilter;
	setExcludeFilter: (filter: ExcludeFilter) => void;

	// State
	selectedYears: Set<number>;
	selectedMonths: Set<number>;
	selectedCategories: Set<string>;

	// Available Options
	availableYears: number[];
	availableMonths: number[];
	availableCategories: {
		id: string;
		name: string;
		color: string;
		icon?: string | null;
		usageCount: number;
	}[];

	// Handlers
	toggleYear: (year: number) => void;
	toggleMonth: (month: number) => void;
	toggleCategory: (categoryId: string) => void;
	clearYears: () => void;
	clearMonths: () => void;
	clearCategories: () => void;

	// Date range
	dateRange: DateRangeState;
	setDateRange: (range: DateRangeState) => void;
	clearDateRange: () => void;

	// Amount range
	amountRange: AmountRange;
	setAmountRange: (range: AmountRange) => void;
	clearAmountRange: () => void;

	// Home currency for amount range display
	homeCurrency?: string;
}

function getTypeOptions(t: ReturnType<typeof useTranslations<"tableFilters">>): { value: TypeFilter; label: string }[] {
	return [
		{ value: "all", label: t("all") },
		{ value: "personal", label: t("personal") },
		{ value: "shared", label: t("shared") },
	];
}

function getExcludeOptions(t: ReturnType<typeof useTranslations<"tableFilters">>): { value: ExcludeFilter; label: string }[] {
	return [
		{ value: "all", label: t("all") },
		{ value: "included", label: t("included") },
		{ value: "excluded", label: t("excludedOnly") },
	];
}

export function TableFilters({
	typeFilter,
	setTypeFilter,
	hasSharedExpenses,
	excludeFilter,
	setExcludeFilter,
	selectedYears,
	selectedMonths,
	selectedCategories,
	availableYears,
	availableMonths,
	availableCategories,
	toggleYear,
	toggleMonth,
	toggleCategory,
	clearYears,
	clearMonths,
	clearCategories,
	dateRange,
	setDateRange,
	clearDateRange,
	amountRange,
	setAmountRange,
	clearAmountRange,
	homeCurrency,
}: TableFiltersProps) {
	const t = useTranslations("tableFilters");
	const tUi = useTranslations("ui");
	const { displayName } = useCategoryName();
	const datePresets = getDatePresets(t);
	const isDateRangeActive = dateRange !== null;
	const TYPE_OPTIONS = useMemo(() => getTypeOptions(t), [t]);
	const EXCLUDE_OPTIONS = useMemo(() => getExcludeOptions(t), [t]);

	// Show expanded categories
	const [showAllCategories, setShowAllCategories] = useState(false);
	const CATEGORY_LIMIT = 10;
	const visibleCategories = showAllCategories
		? availableCategories
		: availableCategories.slice(0, CATEGORY_LIMIT);
	const hasMoreCategories = availableCategories.length > CATEGORY_LIMIT;

	// Derive MonthStepper value from selected year+month
	const monthStepperValue = useMemo(() => {
		if (selectedYears.size !== 1 || selectedMonths.size !== 1) return null;
		const year = [...selectedYears][0]!;
		const month = [...selectedMonths][0]!;
		return new Date(year, month, 1);
	}, [selectedYears, selectedMonths]);

	const monthStepperMin = useMemo(() => {
		if (availableYears.length === 0) return undefined;
		const minYear = Math.min(...availableYears);
		return new Date(minYear, 0, 1);
	}, [availableYears]);

	const monthStepperMax = useMemo(() => {
		if (availableYears.length === 0) return undefined;
		const maxYear = Math.max(...availableYears);
		return new Date(maxYear, 11, 31);
	}, [availableYears]);

	const handleMonthStepperChange = (date: Date) => {
		if (dateRange) clearDateRange();
		// Clear existing selections and set exactly one year+month
		clearYears();
		clearMonths();
		toggleYear(date.getFullYear());
		toggleMonth(date.getMonth());
	};

	const handleMonthStepperClear = () => {
		clearYears();
		clearMonths();
	};

	return (
		<div className="space-y-5">
			{/* Type - only show when user has shared expenses */}
			{hasSharedExpenses && (
				<section className="space-y-2">
					<h3 className="font-medium text-muted-foreground text-xs tracking-wider">
						{t("type")}
					</h3>
					<div className="flex flex-wrap gap-1.5">
						{TYPE_OPTIONS.map(({ value, label }) => (
							<Button
								aria-pressed={typeFilter === value}
								className="h-7 px-3 text-xs"
								key={value}
								onClick={() => setTypeFilter(value)}
								size="sm"
								variant={typeFilter === value ? "default" : "outline"}
							>
								{label}
							</Button>
						))}
					</div>
				</section>
			)}

			{/* Period */}
			<section className="space-y-3">
				<h3 className="font-medium text-muted-foreground text-xs tracking-wider">
					{t("period")}
				</h3>

				{/* Quick presets */}
				<div className="space-y-1.5">
					<span className="text-muted-foreground text-[11px]">{t("quick")}</span>
					<div className="flex flex-wrap gap-1.5">
						{datePresets.map((preset) => (
							<Button
								aria-pressed={dateRange?.preset === preset.key}
								className="h-7 px-3 text-xs"
								key={preset.key}
								onClick={() => {
									clearYears();
									clearMonths();
									setDateRange({
										...preset.getRange(),
										preset: preset.key,
									});
								}}
								size="sm"
								variant={
									dateRange?.preset === preset.key ? "default" : "outline"
								}
							>
								{preset.label}
							</Button>
						))}
					</div>
				</div>

				{/* By month: year dropdown + month chips */}
				<div
					className={cn(
						"space-y-1.5",
						isDateRangeActive && "opacity-40 pointer-events-none",
					)}
				>
					<span className="text-muted-foreground text-[11px]">{t("byMonth")}</span>
					<MonthStepper
						compact
						maxDate={monthStepperMax}
						minDate={monthStepperMin}
						onChange={handleMonthStepperChange}
						onClear={handleMonthStepperClear}
						placeholder={t("selectMonth")}
						value={monthStepperValue}
					/>
				</div>

				{/* Custom date range */}
				<div className="space-y-1.5">
					<span className="text-muted-foreground text-[11px]">{t("customRange")}</span>
					<div className="flex items-center gap-2">
						<DatePicker
							className="w-44"
							date={dateRange && !dateRange.preset ? dateRange.from : undefined}
							inputClassName="h-7 text-xs"
							onSelect={(from) => {
								if (!from) return;
								from.setHours(0, 0, 0, 0);
								clearYears();
								clearMonths();
								const to = dateRange?.to ?? new Date();
								to.setHours(23, 59, 59, 999);
								setDateRange({ from, to });
							}}
							placeholder={t("fromDate")}
						/>
						<span className="text-muted-foreground text-xs">{t("to")}</span>
						<DatePicker
							className="w-44"
							date={dateRange && !dateRange.preset ? dateRange.to : undefined}
							inputClassName="h-7 text-xs"
							onSelect={(to) => {
								if (!to) return;
								to.setHours(23, 59, 59, 999);
								clearYears();
								clearMonths();
								const from = dateRange?.from ?? to;
								setDateRange({ from, to });
							}}
							placeholder={t("toDate")}
						/>
					</div>
				</div>
			</section>

			{/* Category */}
			{availableCategories.length > 0 && (
				<section className="space-y-2">
					<h3 className="font-medium text-muted-foreground text-xs tracking-wider">
						{t("category")}
					</h3>
					<div className="flex flex-wrap gap-1.5">
						{visibleCategories.map((category) => {
							const Icon = getCategoryIcon(category.name, category.icon);
							return (
								<Button
									aria-pressed={selectedCategories.has(category.id)}
									className="flex h-7 items-center gap-1.5 px-2.5 text-xs"
									key={category.id}
									onClick={() => toggleCategory(category.id)}
									size="sm"
									variant={
										selectedCategories.has(category.id)
											? "default"
											: "outline"
									}
								>
									<Icon
										className={cn(
											"h-3 w-3 shrink-0",
											!selectedCategories.has(category.id) &&
												`text-${category.color}-500`,
										)}
									/>
									{displayName(category.name)}
								</Button>
							);
						})}
					</div>
					{hasMoreCategories && (
						<Button
							className="h-6 px-2 text-xs"
							onClick={() => setShowAllCategories(!showAllCategories)}
							size="sm"
							variant="ghost"
						>
							{showAllCategories
								? t("showLess")
								: t("showMore", { count: availableCategories.length - CATEGORY_LIMIT })}
						</Button>
					)}
				</section>
			)}

			{/* Amount Range */}
			<section className="space-y-2">
				<h3 className="font-medium text-muted-foreground text-xs tracking-wider">
					{t("amount")} ({homeCurrency ?? "USD"})
				</h3>
				<div className="flex items-center gap-2">
					<Input
						className="h-7 w-28 text-xs"
						min={0}
						onChange={(e) =>
							setAmountRange({
								...amountRange,
								min: e.target.value ? Number(e.target.value) : undefined,
							})
						}
						placeholder={t("min")}
						step="any"
						type="number"
						value={amountRange.min ?? ""}
					/>
					<span className="text-muted-foreground text-xs">—</span>
					<Input
						className="h-7 w-28 text-xs"
						min={0}
						onChange={(e) =>
							setAmountRange({
								...amountRange,
								max: e.target.value ? Number(e.target.value) : undefined,
							})
						}
						placeholder={t("max")}
						step="any"
						type="number"
						value={amountRange.max ?? ""}
					/>
				</div>
			</section>

			{/* Analytics Status */}
			<section className="space-y-2">
				<h3 className="font-medium text-muted-foreground text-xs tracking-wider">
					{t("analyticsStatus")}
				</h3>
				<div className="flex flex-wrap gap-1.5">
					{EXCLUDE_OPTIONS.map(({ value, label }) => (
						<Button
							aria-pressed={excludeFilter === value}
							className="h-7 px-3 text-xs"
							key={value}
							onClick={() => setExcludeFilter(value)}
							size="sm"
							variant={excludeFilter === value ? "default" : "outline"}
						>
							{label}
						</Button>
					))}
				</div>
			</section>
		</div>
	);
}

// Re-export types and helpers for use by filter-bar
export { getMonthNames, getShortMonthNames, getDatePresets, formatDateForInput };
export type { TypeFilter, ExcludeFilter };
