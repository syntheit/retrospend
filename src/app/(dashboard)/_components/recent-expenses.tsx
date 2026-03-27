"use client";

import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { format } from "date-fns";
import { Edit2, ExternalLink, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { memo, useMemo, useState } from "react";
import { CategoryChip } from "~/components/category-chip";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
} from "~/components/ui/context-menu";
import { Skeleton } from "~/components/ui/skeleton";
import { getCategoryIcon } from "~/lib/category-icons";
import type { CATEGORY_COLOR_MAP } from "~/lib/constants";
import { isCrypto } from "~/lib/currency-format";
import { BRAND_ICON_MAP } from "~/lib/icons";
import { cn } from "~/lib/utils";
import type { RouterOutputs } from "~/trpc/react";

export type ActivityItem =
	RouterOutputs["dashboard"]["getRecentActivity"][number];
type ActivityFilter = "all" | "personal" | "shared";

const MUTED_COLOR_MAP: Record<string, string> = {
	emerald: "bg-emerald-500/10 text-emerald-500",
	blue: "bg-blue-500/10 text-blue-500",
	sky: "bg-sky-500/10 text-sky-500",
	cyan: "bg-cyan-500/10 text-cyan-500",
	teal: "bg-teal-500/10 text-teal-500",
	orange: "bg-orange-500/10 text-orange-500",
	amber: "bg-amber-500/10 text-amber-500",
	violet: "bg-violet-500/10 text-violet-500",
	pink: "bg-pink-500/10 text-pink-500",
	fuchsia: "bg-fuchsia-500/10 text-fuchsia-500",
	indigo: "bg-indigo-500/10 text-indigo-500",
	slate: "bg-slate-500/10 text-slate-500",
	zinc: "bg-zinc-500/10 text-zinc-500",
	lime: "bg-lime-500/10 text-lime-500",
	neutral: "bg-neutral-500/10 text-neutral-500",
	gray: "bg-muted text-muted-foreground",
	purple: "bg-purple-500/10 text-purple-500",
	yellow: "bg-yellow-500/10 text-yellow-500",
	stone: "bg-stone-500/10 text-stone-500",
	rose: "bg-rose-500/10 text-rose-500",
	red: "bg-red-500/10 text-red-500",
};

function getExpenseIcon(
	title: string | null,
	categoryName: string,
	categoryIconName?: string | null,
) {
	if (title) {
		const lowerTitle = title.toLowerCase();
		for (const [keyword, icon] of Object.entries(BRAND_ICON_MAP)) {
			if (lowerTitle.includes(keyword)) {
				return icon;
			}
		}
	}
	return getCategoryIcon(categoryName, categoryIconName);
}

interface RecentExpensesProps {
	activityLoading: boolean;
	recentActivity: ActivityItem[];
	homeCurrency: string;
	liveRateToBaseCurrency: number | null;
	formatCurrency: (amount: number, currency?: string) => string;
	onItemClick?: (item: ActivityItem) => void;
	onDeleteItem?: (item: ActivityItem) => void;
}

export function RecentExpenses({
	activityLoading,
	recentActivity,
	homeCurrency,
	liveRateToBaseCurrency,
	formatCurrency,
	onItemClick,
	onDeleteItem,
}: RecentExpensesProps) {
	const [filter, setFilter] = useState<ActivityFilter>("all");

	const filteredActivity = useMemo(() => {
		if (filter === "all") return recentActivity;
		if (filter === "personal")
			return recentActivity.filter((a) => a.type === "personal");
		return recentActivity.filter(
			(a) => a.type === "shared" || a.type === "settlement",
		);
	}, [recentActivity, filter]);

	const viewAllHref = filter === "shared" ? "/projects" : "/transactions";

	if (activityLoading) {
		return (
			<RecentActivityCard
				filter={filter}
				onFilterChange={setFilter}
				viewAllHref={viewAllHref}
			>
				<div className="space-y-2">
					<Skeleton className="h-12 w-full" />
					<Skeleton className="h-12 w-full" />
					<Skeleton className="h-12 w-full" />
				</div>
			</RecentActivityCard>
		);
	}

	if (filteredActivity.length === 0) {
		return (
			<RecentActivityCard
				filter={filter}
				onFilterChange={setFilter}
				viewAllHref={viewAllHref}
			>
				<div className="flex items-center justify-between rounded-lg border bg-muted/40 p-4">
					<div>
						<div className="font-medium">No recent activity</div>
						<p className="text-muted-foreground text-sm">
							{filter === "personal"
								? "No personal expenses yet."
								: filter === "shared"
									? "No shared expenses or settlements yet."
									: "Create your first expense to see it here."}
						</p>
					</div>
				</div>
			</RecentActivityCard>
		);
	}

	return (
		<RecentActivityCard
			filter={filter}
			onFilterChange={setFilter}
			viewAllHref={viewAllHref}
		>
			<div className="scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent overflow-y-auto lg:h-full">
				<div className="divide-y divide-border">
					{filteredActivity.map((item) => (
						<ActivityRow
							formatCurrency={formatCurrency}
							homeCurrency={homeCurrency}
							item={item}
							key={item.id}
							liveRateToBaseCurrency={liveRateToBaseCurrency}
							onClick={onItemClick}
							onDelete={onDeleteItem}
						/>
					))}
				</div>
			</div>
		</RecentActivityCard>
	);
}

const FILTER_OPTIONS: { value: ActivityFilter; label: string }[] = [
	{ value: "all", label: "All" },
	{ value: "personal", label: "Personal" },
	{ value: "shared", label: "Shared" },
];

function RecentActivityCard({
	children,
	filter,
	onFilterChange,
	viewAllHref,
}: {
	children: React.ReactNode;
	filter: ActivityFilter;
	onFilterChange: (f: ActivityFilter) => void;
	viewAllHref: string;
}) {
	return (
		<Card className="border border-border bg-card shadow-sm lg:flex lg:h-full lg:flex-col">
			<CardHeader className="px-4 sm:px-6">
				<div className="flex items-baseline justify-between">
					<div>
						<CardTitle className="font-semibold text-lg tracking-tight">
							Recent Activity
						</CardTitle>
						<CardDescription>
							Your latest expenses and shared activity
						</CardDescription>
					</div>
					<Button asChild size="sm" variant="ghost">
						<Link href={viewAllHref}>View all</Link>
					</Button>
				</div>
				<div className="flex gap-1 pt-1">
					{FILTER_OPTIONS.map((opt) => (
						<button
							className={cn(
								"cursor-pointer rounded-full px-3 py-1 font-medium text-xs transition-colors",
								filter === opt.value
									? "bg-primary text-primary-foreground"
									: "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground",
							)}
							key={opt.value}
							onClick={() => onFilterChange(opt.value)}
							type="button"
						>
							{opt.label}
						</button>
					))}
				</div>
			</CardHeader>
			<CardContent className="px-4 sm:px-6 lg:min-h-0 lg:flex-1 lg:overflow-hidden">
				{children}
			</CardContent>
		</Card>
	);
}

interface ActivityRowProps {
	item: ActivityItem;
	homeCurrency: string;
	liveRateToBaseCurrency: number | null;
	formatCurrency: (amount: number, currency?: string) => string;
	onClick?: (item: ActivityItem) => void;
	onDelete?: (item: ActivityItem) => void;
}

const ActivityRow = memo(function ActivityRow({
	item,
	homeCurrency,
	liveRateToBaseCurrency,
	formatCurrency,
	onClick,
	onDelete,
}: ActivityRowProps) {
	if (item.type === "settlement") {
		return (
			<SettlementRow
				formatCurrency={formatCurrency}
				item={item}
				onClick={onClick ? () => onClick(item) : undefined}
			/>
		);
	}

	// Personal or shared expense row
	const categoryName = item.category?.name ?? "Uncategorized";
	const categoryIcon = item.category?.icon;
	const colorKey = item.category?.color as keyof typeof CATEGORY_COLOR_MAP;
	const Icon = getExpenseIcon(item.title, categoryName, categoryIcon);

	// Convert amount for display (same rubric as convertExpenseAmountForDisplay)
	let displayAmount = item.amount;
	if (item.amountInUSD && item.currency !== homeCurrency) {
		if (liveRateToBaseCurrency) {
			displayAmount = isCrypto(homeCurrency)
				? item.amountInUSD / liveRateToBaseCurrency
				: item.amountInUSD * liveRateToBaseCurrency;
		} else {
			displayAmount = item.amountInUSD;
		}
	}

	const showOriginal =
		item.currency !== homeCurrency && item.amountInUSD !== null;

	const rowContent = (
		<div
			className={cn(
				"flex w-full items-center gap-3 rounded-md px-2 py-3 text-left",
				onClick && "cursor-pointer transition-colors hover:bg-accent/50",
			)}
			onClick={onClick ? () => onClick(item) : undefined}
			onKeyDown={
				onClick
					? (e) => {
							if (e.key === "Enter" || e.key === " ") onClick(item);
						}
					: undefined
			}
			role={onClick ? "button" : undefined}
			tabIndex={onClick ? 0 : undefined}
		>
			<div
				className={cn(
					"flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full",
					MUTED_COLOR_MAP[colorKey] ?? "bg-muted text-muted-foreground",
				)}
			>
				<Icon className="h-4 w-4" />
			</div>

			<div className="min-w-0 flex-1 space-y-0.5">
				<div className="truncate font-medium text-sm">
					{item.title || "Untitled expense"}
				</div>
				<div className="flex min-w-0 items-center gap-1.5">
					{item.category ? (
						<CategoryChip
							className="max-w-[120px] truncate"
							color={item.category.color}
							icon={item.category.icon}
							name={item.category.name}
						/>
					) : (
						<span className="text-muted-foreground text-xs">No category</span>
					)}
					{item.type === "shared" && item.sharedContext?.projectName && (
						<Badge className="max-w-[100px] truncate" variant="outline">
							{item.sharedContext.projectName}
						</Badge>
					)}
				</div>
				{item.type === "shared" && item.sharedContext && (
					<div className="text-muted-foreground text-xs">
						{item.sharedContext.iPayedThis
							? `You paid · split ${item.sharedContext.participantCount} ways`
							: `Paid by ${item.sharedContext.paidByName}`}
					</div>
				)}
			</div>

			<div className="shrink-0 text-right">
				<div className="whitespace-nowrap font-medium text-muted-foreground text-xs tabular-nums">
					{format(new Date(item.date), "MMM d, yyyy")}
				</div>
				<div className="whitespace-nowrap font-medium text-foreground text-sm tabular-nums">
					{item.type === "shared" ? "Your share: " : ""}
					{formatCurrency(displayAmount, homeCurrency)}
				</div>
				{showOriginal && (
					<div className="whitespace-nowrap font-medium text-[10px] text-muted-foreground tabular-nums">
						{formatCurrency(item.amount, item.currency)}
					</div>
				)}
			</div>
		</div>
	);

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>{rowContent}</ContextMenuTrigger>
			<ContextMenuContent>
				{item.type === "personal" && (
					<>
						<ContextMenuItem onClick={() => onClick?.(item)}>
							<Edit2 className="mr-2 h-4 w-4" />
							Edit expense
						</ContextMenuItem>
						<ContextMenuSeparator />
						<ContextMenuItem
							onClick={() => onDelete?.(item)}
							variant="destructive"
						>
							<Trash2 className="mr-2 h-4 w-4" />
							Delete expense
						</ContextMenuItem>
					</>
				)}
				{item.type === "shared" && (
					<ContextMenuItem onClick={() => onClick?.(item)}>
						<ExternalLink className="mr-2 h-4 w-4" />
						View project
					</ContextMenuItem>
				)}
			</ContextMenuContent>
		</ContextMenu>
	);
});

function SettlementRow({
	item,
	formatCurrency,
	onClick,
}: {
	item: ActivityItem;
	formatCurrency: (amount: number, currency?: string) => string;
	onClick?: () => void;
}) {
	const isIncoming = item.settlementContext?.direction === "incoming";
	const DirectionIcon = isIncoming ? ArrowDownLeft : ArrowUpRight;

	const rowContent = (
		<div
			className={cn(
				"flex w-full items-center gap-3 rounded-md px-2 py-3 text-left",
				onClick && "cursor-pointer transition-colors hover:bg-accent/50",
			)}
			onClick={onClick}
			onKeyDown={
				onClick
					? (e) => {
							if (e.key === "Enter" || e.key === " ") onClick();
						}
					: undefined
			}
			role={onClick ? "button" : undefined}
			tabIndex={onClick ? 0 : undefined}
		>
			<div
				className={cn(
					"flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full",
					isIncoming
						? "bg-emerald-500/10 text-emerald-500"
						: "bg-blue-500/10 text-blue-500",
				)}
			>
				<DirectionIcon className="h-4 w-4" />
			</div>

			<div className="min-w-0 flex-1 space-y-0.5">
				<div className="truncate font-medium text-sm">{item.title}</div>
				<div className="flex items-center gap-1.5">
					<Badge
						variant={
							item.settlementContext?.status === "FINALIZED"
								? "default"
								: "secondary"
						}
					>
						{item.settlementContext?.status === "FINALIZED"
							? "Settled"
							: "Pending"}
					</Badge>
				</div>
			</div>

			<div className="shrink-0 text-right">
				<div className="whitespace-nowrap font-medium text-muted-foreground text-xs tabular-nums">
					{format(new Date(item.date), "MMM d, yyyy")}
				</div>
				<div
					className={cn(
						"whitespace-nowrap font-medium text-sm tabular-nums",
						isIncoming
							? "text-emerald-600 dark:text-emerald-400"
							: "text-foreground",
					)}
				>
					{isIncoming ? "+" : "-"}
					{formatCurrency(item.amount, item.currency)}
				</div>
			</div>
		</div>
	);

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>{rowContent}</ContextMenuTrigger>
			<ContextMenuContent>
				<ContextMenuItem onClick={onClick}>
					<Users className="mr-2 h-4 w-4" />
					View in People
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	);
}
