"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
	Drawer,
	DrawerContent,
	DrawerDescription,
	DrawerTitle,
} from "~/components/ui/drawer";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "~/components/ui/popover";
import { ExpandableSearch } from "~/components/table-search";
import { getCategoryIcon } from "~/lib/category-icons";
import { useIsMobile } from "~/hooks/use-mobile";
import { cn } from "~/lib/utils";
import { TableFilters, type TableFiltersProps, MONTH_NAMES, SHORT_MONTH_NAMES, getDatePresets, formatDateForInput } from "./table-filters";

interface FilterBarProps extends TableFiltersProps {
	clearFilters: () => void;
	searchQuery: string;
	onSearchChange: (v: string) => void;
	searchPlaceholder?: string;
	displayedCount: number;
}

type ActivePill = {
	key: string;
	label: string;
	icon?: React.ComponentType<{ className?: string }>;
	onDismiss: () => void;
};

function useActivePills(props: FilterBarProps): ActivePill[] {
	const pills: ActivePill[] = [];

	// Type filter (only relevant when user has shared expenses)
	if (props.hasSharedExpenses && props.typeFilter !== "all") {
		pills.push({
			key: "type",
			label: props.typeFilter === "personal" ? "Personal" : "Shared",
			onDismiss: () => props.setTypeFilter("all"),
		});
	}

	// Exclude filter
	if (props.excludeFilter !== "all") {
		pills.push({
			key: "exclude",
			label:
				props.excludeFilter === "included" ? "Included only" : "Excluded only",
			onDismiss: () => props.setExcludeFilter("all"),
		});
	}

	// Date range
	if (props.dateRange) {
		const presets = getDatePresets();
		let label: string;
		if (props.dateRange.preset) {
			const preset = presets.find((p) => p.key === props.dateRange!.preset);
			label = preset?.label ?? "Custom range";
		} else {
			const from = formatDateForInput(props.dateRange.from);
			const to = formatDateForInput(props.dateRange.to);
			label = `${from} – ${to}`;
		}
		pills.push({
			key: "daterange",
			label,
			onDismiss: props.clearDateRange,
		});
	}

	// Year + Month (when no date range active)
	if (!props.dateRange) {
		// Show combined year+month pills
		if (props.selectedYears.size > 0 && props.selectedMonths.size > 0) {
			for (const year of props.selectedYears) {
				for (const month of props.selectedMonths) {
					pills.push({
						key: `ym-${year}-${month}`,
						label: `${SHORT_MONTH_NAMES[month]} ${year}`,
						onDismiss: () => {
							// Remove month; if it's the last month, also remove the year
							props.toggleMonth(month);
						},
					});
				}
			}
		} else if (props.selectedYears.size > 0) {
			for (const year of props.selectedYears) {
				pills.push({
					key: `y-${year}`,
					label: String(year),
					onDismiss: () => props.toggleYear(year),
				});
			}
		} else if (props.selectedMonths.size > 0) {
			for (const month of props.selectedMonths) {
				pills.push({
					key: `m-${month}`,
					label: MONTH_NAMES[month]!,
					onDismiss: () => props.toggleMonth(month),
				});
			}
		}
	}

	// Categories
	if (props.selectedCategories.size > 0) {
		if (props.selectedCategories.size <= 3) {
			for (const catId of props.selectedCategories) {
				const cat = props.availableCategories.find((c) => c.id === catId);
				if (cat) {
					const Icon = getCategoryIcon(cat.name, cat.icon);
					pills.push({
						key: `cat-${catId}`,
						label: cat.name,
						icon: Icon,
						onDismiss: () => props.toggleCategory(catId),
					});
				}
			}
		} else {
			pills.push({
				key: "categories",
				label: `${props.selectedCategories.size} categories`,
				onDismiss: props.clearCategories,
			});
		}
	}

	// Amount range
	if (props.amountRange.min != null || props.amountRange.max != null) {
		const currency = props.homeCurrency ?? "USD";
		let label: string;
		if (props.amountRange.min != null && props.amountRange.max != null) {
			label = `${currency} ${props.amountRange.min} – ${props.amountRange.max}`;
		} else if (props.amountRange.min != null) {
			label = `Min ${currency} ${props.amountRange.min}`;
		} else {
			label = `Max ${currency} ${props.amountRange.max}`;
		}
		pills.push({
			key: "amount",
			label,
			onDismiss: props.clearAmountRange,
		});
	}

	return pills;
}

function countActiveFilters(props: FilterBarProps): number {
	let count = 0;
	if (props.hasSharedExpenses && props.typeFilter !== "all") count++;
	if (props.excludeFilter !== "all") count++;
	// Period: date range OR year/month selection counts as a single filter
	if (
		props.dateRange ||
		(!props.dateRange &&
			(props.selectedYears.size > 0 || props.selectedMonths.size > 0))
	)
		count++;
	if (props.selectedCategories.size > 0) count++;
	if (props.amountRange.min != null || props.amountRange.max != null) count++;
	return count;
}

function FilterPill({
	label,
	icon: Icon,
	onDismiss,
}: {
	label: string;
	icon?: React.ComponentType<{ className?: string }>;
	onDismiss: () => void;
}) {
	return (
		<Badge
			className="inline-flex shrink-0 cursor-default items-center gap-1 pr-1"
			variant="secondary"
		>
			{Icon && <Icon className="h-3 w-3" />}
			<span>{label}</span>
			<Button
				className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-muted-foreground/20"
				onClick={onDismiss}
				type="button"
				variant="ghost"
				size="icon"
			>
				<X className="h-2.5 w-2.5" />
			</Button>
		</Badge>
	);
}

export function FilterBar(props: FilterBarProps) {
	const [open, setOpen] = useState(false);
	const isMobile = useIsMobile();
	const pills = useActivePills(props);
	const activeCount = countActiveFilters(props);
	const hasActiveFilters = pills.length > 0;

	const countLabel =
		props.displayedCount === 1 ? "1 expense" : `${props.displayedCount} expenses`;

	const filterButton = (
		<Button
			className="relative h-7 px-2 text-xs"
			onClick={() => setOpen(!open)}
			size="sm"
			variant={activeCount > 0 ? "secondary" : "ghost"}
		>
			<SlidersHorizontal className="h-3.5 w-3.5" />
			Filters
			{activeCount > 0 && (
				<span className="ml-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-semibold tabular-nums text-[10px] text-primary-foreground">
					{activeCount}
				</span>
			)}
		</Button>
	);

	const panelContent = (
		<div className="max-h-[70vh] overflow-y-auto">
			<TableFilters {...props} />
		</div>
	);

	const handleClearAll = () => {
		props.clearFilters();
		props.setTypeFilter("all");
		props.setExcludeFilter("all");
	};

	return (
		<div className="space-y-2">
			{/* Compact bar */}
			<div className="flex items-center gap-2">
				<span className="shrink-0 tabular-nums text-muted-foreground text-sm">
					{countLabel}
				</span>

				{isMobile ? (
					<>
						{filterButton}
						<Drawer
							direction="bottom"
							onOpenChange={setOpen}
							open={open}
						>
							<DrawerContent className="px-6 pb-6">
								<DrawerTitle className="mb-4 text-left font-semibold text-lg">
									Filters
								</DrawerTitle>
								<DrawerDescription className="sr-only">
									Filter transactions by date, category, and amount
								</DrawerDescription>
								{panelContent}
								<Button
									className="mt-4 w-full"
									onClick={() => setOpen(false)}
									size="sm"
									variant="outline"
								>
									Done
								</Button>
							</DrawerContent>
						</Drawer>
					</>
				) : (
					<Popover onOpenChange={setOpen} open={open}>
						<PopoverTrigger asChild>{filterButton}</PopoverTrigger>
						<PopoverContent
							align="start"
							className="w-[560px] p-4"
							sideOffset={8}
						>
							{panelContent}
						</PopoverContent>
					</Popover>
				)}

				{hasActiveFilters && (
					<Button
						className="h-8 shrink-0 px-2 text-xs text-muted-foreground"
						onClick={handleClearAll}
						size="sm"
						variant="ghost"
					>
						Clear all
					</Button>
				)}

				<ExpandableSearch
					onChange={props.onSearchChange}
					placeholder={props.searchPlaceholder ?? "Search expenses..."}
					value={props.searchQuery}
					captureTyping
				/>
			</div>

			{/* Active filter pills */}
			{hasActiveFilters && (
				<div
					className={cn(
						"flex gap-1.5 overflow-x-auto pb-1",
						"scrollbar-none [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
					)}
				>
					{pills.map((pill) => (
						<FilterPill
							icon={pill.icon}
							key={pill.key}
							label={pill.label}
							onDismiss={pill.onDismiss}
						/>
					))}
				</div>
			)}
		</div>
	);
}
