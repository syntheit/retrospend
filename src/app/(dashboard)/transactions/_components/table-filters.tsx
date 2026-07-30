"use client";

import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { cn } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { DatePicker } from "~/components/ui/date-picker";
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

/**
 * The last `count` months as {year, month} pairs, newest first. Powers the
 * quick "By month" chips (e.g. "July 2026", "June 2026", …) so the picker no
 * longer surfaces only the current month.
 */
function getRecentMonths(count = 12): { year: number; month: number }[] {
	const out: { year: number; month: number }[] = [];
	const now = new Date();
	for (let i = 0; i < count; i++) {
		const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
		out.push({ year: d.getFullYear(), month: d.getMonth() });
	}
	return out;
}

/** How many project chips the "Category" scope row shows. Capped small so the
 * row never overflows or scrolls; the rest stay reachable via the projects page. */
const PROJECT_CHIP_LIMIT = 3;

export interface TableFiltersProps {
	// Type filter
	typeFilter: TypeFilter;
	setTypeFilter: (type: TypeFilter) => void;

	// Whether the user has any shared expenses at all
	hasSharedExpenses?: boolean;

	// Project scope (part of the "Category" control): selecting a project chip
	// narrows the list to that project's shared expenses.
	projectFilter: string | null;
	setProjectFilter: (projectId: string | null) => void;
	availableProjects: { id: string; name: string }[];

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
	projectFilter,
	setProjectFilter,
	availableProjects,
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
	const MONTH_NAMES = useMemo(() => getMonthNames(tUi), [tUi]);
	const SHORT_MONTH_NAMES = useMemo(() => getShortMonthNames(tUi), [tUi]);
	const { displayName } = useCategoryName();
	const datePresets = getDatePresets(t);
	const isDateRangeActive = dateRange !== null;
	const TYPE_OPTIONS = useMemo(() => getTypeOptions(t), [t]);
	const EXCLUDE_OPTIONS = useMemo(() => getExcludeOptions(t), [t]);

	// Recent months for the quick "By month" chips (newest first, e.g. "July 2026").
	const recentMonths = useMemo(() => getRecentMonths(12), []);
	// Cap project chips so the "Category" row never overflows / scrolls.
	const projectChips = useMemo(
		() => availableProjects.slice(0, PROJECT_CHIP_LIMIT),
		[availableProjects],
	);

	// Select a single year+month from the chips, mirroring the stepper's single-select.
	const selectMonth = (year: number, month: number) => {
		if (dateRange) clearDateRange();
		const alreadySelected =
			selectedYears.size === 1 &&
			selectedMonths.size === 1 &&
			selectedYears.has(year) &&
			selectedMonths.has(month);
		clearYears();
		clearMonths();
		if (!alreadySelected) {
			toggleYear(year);
			toggleMonth(month);
		}
	};

	const isMonthChipActive = (year: number, month: number) =>
		selectedYears.size === 1 &&
		selectedMonths.size === 1 &&
		selectedYears.has(year) &&
		selectedMonths.has(month);

	// Show expanded categories
	const [showAllCategories, setShowAllCategories] = useState(false);
	const CATEGORY_LIMIT = 10;
	const visibleCategories = showAllCategories
		? availableCategories
		: availableCategories.slice(0, CATEGORY_LIMIT);
	const hasMoreCategories = availableCategories.length > CATEGORY_LIMIT;

	return (
		<div className="space-y-5">
			{/* Category (scope): All / Personal / Shared + recent project chips.
			    Shown when the user has shared expenses or belongs to any project. */}
			{(hasSharedExpenses || projectChips.length > 0) && (
				<section className="space-y-2">
					<h3 className="font-medium text-muted-foreground text-xs tracking-wider">
						{t("category")}
					</h3>
					<div className="flex flex-wrap gap-1.5">
						{TYPE_OPTIONS.map(({ value, label }) => {
							const active = projectFilter === null && typeFilter === value;
							return (
								<Button
									aria-pressed={active}
									className="h-7 px-3 text-xs"
									key={value}
									onClick={() => {
										setProjectFilter(null);
										setTypeFilter(value);
									}}
									size="sm"
									variant={active ? "default" : "outline"}
								>
									{label}
								</Button>
							);
						})}
						{projectChips.map((project) => {
							const active = projectFilter === project.id;
							return (
								<Button
									aria-pressed={active}
									className="h-7 max-w-[10rem] px-3 text-xs"
									key={project.id}
									onClick={() =>
										setProjectFilter(active ? null : project.id)
									}
									size="sm"
									title={project.name}
									variant={active ? "default" : "outline"}
								>
									<span className="truncate">{project.name}</span>
								</Button>
							);
						})}
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
					{/* Quick chips for the last 12 months (newest first). Selecting one
					    sets a single year+month; the stepper below still allows reaching
					    any earlier month. */}
					<div className="flex flex-wrap gap-1.5">
						{recentMonths.map(({ year, month }) => {
							const active = isMonthChipActive(year, month);
							return (
								<Button
									aria-pressed={active}
									className="h-7 px-2.5 text-xs"
									key={`${year}-${month}`}
									onClick={() => {
										if (active) {
											clearYears();
											clearMonths();
										} else {
											selectMonth(year, month);
										}
									}}
									size="sm"
									variant={active ? "default" : "outline"}
								>
									{`${SHORT_MONTH_NAMES[month]} ${String(year).slice(-2)}`}
								</Button>
							);
						})}
					</div>
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

			{/* Spending category (expense categories: Food, Transport, …) */}
			{availableCategories.length > 0 && (
				<section className="space-y-2">
					<h3 className="font-medium text-muted-foreground text-xs tracking-wider">
						{t("spendingCategory")}
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
