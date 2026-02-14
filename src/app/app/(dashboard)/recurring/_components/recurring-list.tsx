"use client";

import {
	CalendarClock,
	ExternalLink,
	MoreVertical,
	Pencil,
	Trash2,
} from "lucide-react";
import { BrandIcon } from "~/components/ui/BrandIcon";
import { Button } from "~/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { useRecurringStatus } from "~/hooks/use-recurring-status";
import { cn } from "~/lib/utils";
import type { RecurringTemplate } from "~/types/recurring";

interface RecurringListProps {
	templates?: RecurringTemplate[];
	loading: boolean;
	onCreate: () => void;
	onEdit: (template: RecurringTemplate) => void;
	onDelete: (id: string) => void;
}

export function RecurringList({
	templates,
	loading,
	onCreate,
	onEdit,
	onDelete,
}: RecurringListProps) {
	const { formatCurrency } = useCurrencyFormatter();

	if (loading) {
		return (
			<div className="space-y-4">
				<div className="h-24 animate-pulse rounded-xl bg-muted" />
				<div className="h-24 animate-pulse rounded-xl bg-muted" />
				<div className="h-24 animate-pulse rounded-xl bg-muted" />
			</div>
		);
	}

	if (!templates || templates.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-12 text-center">
				<CalendarClock className="mx-auto h-12 w-12 text-muted-foreground" />
				<h3 className="mt-4 font-semibold text-lg">No recurring expenses</h3>
				<p className="mt-2 text-muted-foreground text-sm">
					Add your fixed costs like Rent, Netflix, Gym, etc.
				</p>
				<Button className="mt-4" onClick={onCreate}>
					Add Recurring Expense
				</Button>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			{templates.map((template) => (
				<RecurringRow
					formatCurrency={formatCurrency}
					key={template.id}
					onDelete={onDelete}
					onEdit={onEdit}
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
}

function RecurringRow({
	template,
	formatCurrency,
	onEdit,
	onDelete,
}: RecurringRowProps) {
	const { status, color } = useRecurringStatus(template);

	return (
		<div className="group relative flex items-center gap-4 rounded-xl border border-border bg-card p-4 transition-all hover:bg-accent/50 hover:shadow-sm">
			{/* Left: Brand Icon */}
			<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-secondary/50">
				<BrandIcon
					className="h-8 w-8 rounded-full shadow-sm"
					name={template.name}
					size={32}
					url={template.websiteUrl}
				/>
			</div>

			{/* Middle: Name + Status */}
			<div className="min-w-0 flex-1">
				<h4 className="truncate font-semibold text-base text-foreground">
					{template.name}
				</h4>
				<div className="flex items-center gap-2 text-muted-foreground text-sm">
					<span className={cn("font-medium", color)}>{status}</span>
					{template.paymentSource && (
						<>
							<span className="opacity-40">•</span>
							<span className="truncate">via {template.paymentSource}</span>
						</>
					)}
				</div>
			</div>

			{/* Right: Amount + Actions */}
			<div className="flex items-center gap-4">
				<p className="text-right font-bold text-lg tabular-nums">
					{formatCurrency(Number(template.amount), template.currency)}
				</p>

				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							className="h-8 w-8 text-muted-foreground opacity-50 transition-opacity hover:text-foreground hover:opacity-100"
							size="icon"
							variant="ghost"
						>
							<MoreVertical className="h-4 w-4" />
							<span className="sr-only">Actions</span>
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onClick={() => onEdit(template)}>
							<Pencil className="mr-2 h-4 w-4" />
							Edit
						</DropdownMenuItem>
						{template.websiteUrl && (
							<DropdownMenuItem asChild>
								<a
									href={template.websiteUrl}
									rel="noopener noreferrer"
									target="_blank"
								>
									<ExternalLink className="mr-2 h-4 w-4" />
									Visit Website
								</a>
							</DropdownMenuItem>
						)}
						<DropdownMenuSeparator />
						<DropdownMenuItem
							className="text-destructive focus:text-destructive"
							onClick={() => onDelete(template.id)}
						>
							<Trash2 className="mr-2 h-4 w-4" />
							Delete
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	);
}
