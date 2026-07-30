"use client";

import type { ColumnDef, VisibilityState } from "@tanstack/react-table";
import {
	CalendarClock,
	ExternalLink,
	History,
	MoreHorizontal,
	Pause,
	Pencil,
	Play,
	Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import * as React from "react";
import { CategoryChip } from "~/components/category-chip";
import { DataTable } from "~/components/data-table";
import { BrandIcon } from "~/components/ui/BrandIcon";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
	ContextMenuItem,
	ContextMenuSeparator,
} from "~/components/ui/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { EmptyState } from "~/components/ui/empty-state";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { useIsMobile } from "~/hooks/use-mobile";
import { useRecurringStatus } from "~/hooks/use-recurring-status";
import { FREQUENCY_LABELS } from "~/lib/recurring";
import { cn } from "~/lib/utils";
import type { RecurringTemplate } from "~/types/recurring";

interface RecurringListProps {
	templates?: RecurringTemplate[];
	loading: boolean;
	searchActive?: boolean;
	onCreate: () => void;
	onResetSearch?: () => void;
	onEdit: (template: RecurringTemplate) => void;
	onDelete: (id: string) => void;
	onTogglePause: (id: string, isActive: boolean) => void;
	onViewHistory: (id: string) => void;
}

type MenuAction = {
	id: string;
	label: string;
	icon: React.ComponentType<{ className?: string }>;
	onClick: () => void;
	variant?: "destructive";
	separator?: boolean;
	href?: string;
};

type RowActionHandlers = Pick<
	RecurringListProps,
	"onEdit" | "onDelete" | "onTogglePause" | "onViewHistory"
>;

/**
 * Builds the shared row action list consumed by both the per-row "⋯" dropdown
 * and the DataTable right-click context menu. Kept as a plain function (not a
 * hook) so it can run inside cell renderers; the translation function is passed
 * in from the component that owns the `useTranslations` call.
 */
function buildRowActions(
	template: RecurringTemplate,
	handlers: RowActionHandlers,
	t: (key: string) => string,
): MenuAction[] {
	const isPaused = !template.isActive;

	const actions: MenuAction[] = [
		{
			id: "edit",
			label: t("edit"),
			icon: Pencil,
			onClick: () => handlers.onEdit(template),
		},
		{
			id: "toggle-pause",
			label: isPaused ? t("resume") : t("pause"),
			icon: isPaused ? Play : Pause,
			onClick: () => handlers.onTogglePause(template.id, !template.isActive),
		},
		{
			id: "history",
			label: t("viewHistory"),
			icon: History,
			onClick: () => handlers.onViewHistory(template.id),
		},
	];

	if (template.websiteUrl) {
		actions.push({
			id: "website",
			label: t("visitWebsite"),
			icon: ExternalLink,
			onClick: () => {},
			href: template.websiteUrl,
		});
	}

	actions.push({
		id: "delete",
		label: t("delete"),
		icon: Trash2,
		onClick: () => handlers.onDelete(template.id),
		variant: "destructive",
		separator: true,
	});

	return actions;
}

/** Status cell — mirrors the frequency + semantic-colored status subtitle. */
function StatusCell({ template }: { template: RecurringTemplate }) {
	const { status, color } = useRecurringStatus(template);
	const frequencyLabel =
		FREQUENCY_LABELS[template.frequency] ?? template.frequency;

	return (
		<div className="flex items-center gap-1.5 text-muted-foreground text-xs">
			<span>{frequencyLabel}</span>
			<span className="opacity-40">·</span>
			<span className={cn("font-medium", color)}>{status}</span>
		</div>
	);
}

function createRecurringColumns(
	formatCurrency: (value: number, currency?: string) => string,
	handlers: RowActionHandlers,
	t: (key: string) => string,
): ColumnDef<RecurringTemplate>[] {
	return [
		{
			accessorKey: "name",
			header: t("yourSubscriptions"),
			enableSorting: false,
			meta: { flex: true },
			cell: ({ row }) => {
				const template = row.original;
				const isPaused = !template.isActive;
				return (
					<div className="flex items-center gap-2">
						<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary/50">
							<BrandIcon
								className="h-6 w-6 rounded-full shadow-sm"
								name={template.name}
								size={24}
								url={template.websiteUrl}
							/>
						</div>
						<span className="truncate font-medium text-foreground text-sm">
							{template.name}
						</span>
						{isPaused && (
							<Badge className="text-[10px]" variant="secondary">
								{t("pausedBadge")}
							</Badge>
						)}
					</div>
				);
			},
		},
		{
			accessorKey: "category",
			header: t("fieldCategory"),
			enableSorting: false,
			size: 150,
			meta: { className: "text-center" },
			cell: ({ row }) => {
				const category = row.original.category;
				if (!category) return null;
				return (
					<CategoryChip color={category.color} name={category.name} />
				);
			},
		},
		{
			id: "status",
			header: t("nextPayment"),
			enableSorting: false,
			size: 220,
			cell: ({ row }) => <StatusCell template={row.original} />,
		},
		{
			id: "amount",
			header: t("fieldAmount"),
			enableSorting: false,
			size: 160,
			meta: { align: "right" },
			cell: ({ row }) => {
				const template = row.original;
				const isPaused = !template.isActive;
				return (
					<div
						className={cn(
							"w-full text-right font-medium tabular-nums",
							isPaused && "text-muted-foreground",
						)}
					>
						{formatCurrency(Number(template.amount), template.currency)}
					</div>
				);
			},
		},
		{
			id: "actions",
			header: () => null,
			enableSorting: false,
			enableHiding: false,
			size: 48,
			cell: ({ row }) => {
				const actions = buildRowActions(row.original, handlers, t);
				return (
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								className="h-8 w-8 md:opacity-0 transition-opacity md:group-hover:opacity-100"
								size="icon"
								variant="ghost"
							>
								<MoreHorizontal className="h-4 w-4" />
								<span className="sr-only">{t("actions")}</span>
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="w-44">
							{actions.map((action) => (
								<React.Fragment key={action.id}>
									{action.separator && <DropdownMenuSeparator />}
									{action.href ? (
										<DropdownMenuItem asChild>
											<a
												href={action.href}
												rel="noopener noreferrer"
												target="_blank"
											>
												<action.icon className="mr-2 h-4 w-4" />
												{action.label}
											</a>
										</DropdownMenuItem>
									) : (
										<DropdownMenuItem
											onClick={action.onClick}
											variant={action.variant}
										>
											<action.icon className="mr-2 h-4 w-4" />
											{action.label}
										</DropdownMenuItem>
									)}
								</React.Fragment>
							))}
						</DropdownMenuContent>
					</DropdownMenu>
				);
			},
		},
	];
}

export function RecurringList({
	templates,
	loading,
	searchActive,
	onCreate,
	onResetSearch,
	onEdit,
	onDelete,
	onTogglePause,
	onViewHistory,
}: RecurringListProps) {
	const t = useTranslations("recurring");
	const { formatCurrency } = useCurrencyFormatter();
	const isMobile = useIsMobile();

	const handlers = React.useMemo<RowActionHandlers>(
		() => ({ onEdit, onDelete, onTogglePause, onViewHistory }),
		[onEdit, onDelete, onTogglePause, onViewHistory],
	);

	const columns = React.useMemo(
		() => createRecurringColumns(formatCurrency, handlers, t),
		[formatCurrency, handlers, t],
	);

	// Hide the category column on mobile to reduce horizontal scroll.
	const columnVisibility: VisibilityState = isMobile
		? { category: false }
		: {};

	if (loading) {
		return (
			<div className="relative overflow-hidden rounded-xl border">
				<div className="border-b px-4 py-3">
					<div className="h-4 w-32 animate-pulse rounded bg-accent" />
				</div>
				{[0, 1, 2, 3].map((i) => (
					<div
						className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0"
						key={i}
					>
						<div className="h-9 w-9 shrink-0 animate-pulse rounded-lg bg-accent" />
						<div className="h-4 w-36 animate-pulse rounded bg-accent" />
						<div className="ml-auto h-4 w-20 animate-pulse rounded bg-accent" />
					</div>
				))}
			</div>
		);
	}

	return (
		<DataTable
			columns={columns}
			columnVisibility={columnVisibility}
			data={templates ?? []}
			emptyState={
				searchActive ? (
					<EmptyState
						description={t("noMatchesDescription")}
						icon={CalendarClock}
						secondaryAction={
							onResetSearch
								? {
										label: t("resetSearch"),
										onClick: onResetSearch,
										variant: "outline",
									}
								: undefined
						}
						title={t("noMatchesTitle")}
					/>
				) : (
					<EmptyState
						action={{ label: t("addRecurring"), onClick: onCreate }}
						description={t("emptyDescription")}
						icon={CalendarClock}
						title={t("emptyTitle")}
					/>
				)
			}
			hideCount
			onMobileRowActivate={(row) => onEdit(row)}
			onRowClick={onEdit}
			renderContextMenu={(row) => {
				const actions = buildRowActions(row, handlers, t);
				return (
					<>
						{actions.map((action) => (
							<React.Fragment key={action.id}>
								{action.separator && <ContextMenuSeparator />}
								{action.href ? (
									<ContextMenuItem asChild>
										<a
											href={action.href}
											rel="noopener noreferrer"
											target="_blank"
										>
											<action.icon className="mr-2 h-4 w-4" />
											{action.label}
										</a>
									</ContextMenuItem>
								) : (
									<ContextMenuItem
										onClick={action.onClick}
										variant={action.variant}
									>
										<action.icon className="mr-2 h-4 w-4" />
										{action.label}
									</ContextMenuItem>
								)}
							</React.Fragment>
						))}
					</>
				);
			}}
			searchable={false}
		/>
	);
}
