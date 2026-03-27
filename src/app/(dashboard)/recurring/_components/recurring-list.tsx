"use client";

import {
	CalendarClock,
	ExternalLink,
	History,
	MoreVertical,
	Pause,
	Pencil,
	Play,
	Trash2,
} from "lucide-react";
import * as React from "react";
import { CategoryChip } from "~/components/category-chip";
import { BrandIcon } from "~/components/ui/BrandIcon";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuTrigger,
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
import { useRecurringStatus } from "~/hooks/use-recurring-status";
import { FREQUENCY_LABELS } from "~/lib/recurring";
import { cn } from "~/lib/utils";
import type { RecurringTemplate } from "~/types/recurring";

interface RecurringListProps {
	templates?: RecurringTemplate[];
	loading: boolean;
	onCreate: () => void;
	onEdit: (template: RecurringTemplate) => void;
	onDelete: (id: string) => void;
	onTogglePause: (id: string, isActive: boolean) => void;
	onViewHistory: (id: string) => void;
}

export function RecurringList({
	templates,
	loading,
	onCreate,
	onEdit,
	onDelete,
	onTogglePause,
	onViewHistory,
}: RecurringListProps) {
	const { formatCurrency } = useCurrencyFormatter();

	if (loading) {
		return (
			<div className="space-y-2">
				<div className="h-[72px] animate-pulse rounded-xl bg-muted" />
				<div className="h-[72px] animate-pulse rounded-xl bg-muted" />
				<div className="h-[72px] animate-pulse rounded-xl bg-muted" />
			</div>
		);
	}

	if (!templates || templates.length === 0) {
		return (
			<div className="rounded-xl border border-dashed">
				<EmptyState
					action={{ label: "Add Recurring Expense", onClick: onCreate }}
					description="Add your fixed costs like Rent, Netflix, Gym, etc."
					icon={CalendarClock}
					title="No Recurring Expenses"
				/>
			</div>
		);
	}

	return (
		<div className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border border-border">
			{templates.map((template) => (
				<RecurringRow
					formatCurrency={formatCurrency}
					key={template.id}
					onDelete={onDelete}
					onEdit={onEdit}
					onTogglePause={onTogglePause}
					onViewHistory={onViewHistory}
					template={template}
				/>
			))}
		</div>
	);
}

interface RecurringRowProps {
	template: RecurringTemplate;
	formatCurrency: (value: number, currency?: string) => string;
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

function useRowMenuActions(
	template: RecurringTemplate,
	handlers: Pick<RecurringRowProps, "onEdit" | "onDelete" | "onTogglePause" | "onViewHistory">,
): MenuAction[] {
	const isPaused = !template.isActive;

	const actions: MenuAction[] = [
		{
			id: "edit",
			label: "Edit",
			icon: Pencil,
			onClick: () => handlers.onEdit(template),
		},
		{
			id: "toggle-pause",
			label: isPaused ? "Resume" : "Pause",
			icon: isPaused ? Play : Pause,
			onClick: () => handlers.onTogglePause(template.id, !template.isActive),
		},
		{
			id: "history",
			label: "View History",
			icon: History,
			onClick: () => handlers.onViewHistory(template.id),
		},
	];

	if (template.websiteUrl) {
		actions.push({
			id: "website",
			label: "Visit Website",
			icon: ExternalLink,
			onClick: () => {},
			href: template.websiteUrl,
		});
	}

	actions.push({
		id: "delete",
		label: "Delete",
		icon: Trash2,
		onClick: () => handlers.onDelete(template.id),
		variant: "destructive",
		separator: true,
	});

	return actions;
}

function RecurringRow({
	template,
	formatCurrency,
	onEdit,
	onDelete,
	onTogglePause,
	onViewHistory,
}: RecurringRowProps) {
	const { status, color } = useRecurringStatus(template);
	const frequencyLabel =
		FREQUENCY_LABELS[template.frequency] ?? template.frequency;
	const isPaused = !template.isActive;
	const menuActions = useRowMenuActions(template, {
		onEdit,
		onDelete,
		onTogglePause,
		onViewHistory,
	});

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>
				<div
					className={cn(
						"group flex cursor-pointer items-center gap-3 bg-card px-4 py-3 transition-colors duration-150 hover:bg-muted/40 sm:gap-4",
						isPaused && "opacity-50",
					)}
					onClick={() => onEdit(template)}
				>
					{/* Brand Icon */}
					<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary/50">
						<BrandIcon
							className="h-6 w-6 rounded-full shadow-sm"
							name={template.name}
							size={24}
							url={template.websiteUrl}
						/>
					</div>

					{/* Name + Category + Frequency/Status */}
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2">
							<span className="truncate font-medium text-foreground text-sm">
								{template.name}
							</span>
							{isPaused && (
								<Badge variant="secondary" className="text-[10px]">
									Paused
								</Badge>
							)}
							{template.category && (
								<CategoryChip
									className="hidden shrink-0 sm:inline-flex"
									color={template.category.color}
									name={template.category.name}
								/>
							)}
						</div>
						<div className="mt-0.5 flex items-center gap-1.5 text-muted-foreground text-xs">
							<span>{frequencyLabel}</span>
							<span className="opacity-40">·</span>
							<span className={cn("font-medium", color)}>{status}</span>
						</div>
					</div>

					{/* Amount + Actions */}
					<div className="flex shrink-0 items-center gap-3">
						<p className="font-semibold text-base tabular-nums">
							{formatCurrency(Number(template.amount), template.currency)}
						</p>

						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									className="h-7 w-7 text-muted-foreground opacity-50 transition-opacity hover:text-foreground hover:opacity-100"
									size="icon"
									variant="ghost"
								>
									<MoreVertical className="h-4 w-4" />
									<span className="sr-only">Actions</span>
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								{menuActions.map((action) => (
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
												onClick={(e) => {
													e.stopPropagation();
													action.onClick();
												}}
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
					</div>
				</div>
			</ContextMenuTrigger>
			<ContextMenuContent>
				{menuActions.map((action) => (
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
			</ContextMenuContent>
		</ContextMenu>
	);
}
