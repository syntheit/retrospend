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
import { type RecurringTemplate } from "~/types/recurring";

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
			<div className="space-y-2">
				<div className="h-16 animate-pulse rounded-lg bg-muted" />
				<div className="h-16 animate-pulse rounded-lg bg-muted" />
				<div className="h-16 animate-pulse rounded-lg bg-muted" />
			</div>
		);
	}

	if (!templates || templates.length === 0) {
		return (
			<div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-center">
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
		<div className="flex flex-col gap-2">
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
	const { progress, status, color } = useRecurringStatus(template);

	return (
		<div className="group relative flex items-start gap-4 overflow-hidden rounded-lg border bg-card p-4 pb-6 transition-all hover:bg-accent/50 hover:shadow-sm">
			{/* Left: Brand Icon */}
			<div className="shrink-0 pt-0.5">
				<BrandIcon
					className="h-10 w-10 shrink-0 rounded-full shadow-sm"
					name={template.name}
					url={template.websiteUrl}
				/>
			</div>

			{/* Middle: Context */}
			<div className="min-w-0 flex-1 flex-col justify-center gap-1.5 self-center">
				{/* Top line: Name */}
				<h4 className="truncate font-medium text-base text-foreground">
					{template.name}
				</h4>

				{/* Bottom line: Metadata */}
				<div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
					{template.category && (
						<div className="flex items-center gap-1.5">
							<div
								className="h-1.5 w-1.5 shrink-0 rounded-full"
								style={{
									backgroundColor: template.category.color ?? "currentColor",
								}}
							/>
							<span>{template.category.name}</span>
						</div>
					)}

					{template.category && <span className="text-muted-foreground/40">•</span>}

					{/* Date Context */}
					<div className="flex items-center">
						<span className={cn("font-medium", color)}>
							{status}
						</span>
					</div>

					{template.paymentSource && (
						<>
							<span className="text-muted-foreground/40">•</span>
							<span className="truncate">via {template.paymentSource}</span>
						</>
					)}
				</div>
			</div>

			{/* Right: Actions */}
			<div className="flex shrink-0 items-center gap-4 self-center">
				{/* Amount */}
				<p className="whitespace-nowrap font-mono font-medium text-base tabular-nums">
					{formatCurrency(Number(template.amount), template.currency)}
				</p>

				{/* Visit Button - Desktop */}
				{template.websiteUrl && (
					<Button
						asChild
						className="hidden h-8 w-8 text-muted-foreground opacity-50 transition-opacity hover:text-foreground hover:opacity-100 sm:flex"
						size="icon"
						variant="ghost"
					>
						<a
							href={template.websiteUrl}
							rel="noopener noreferrer"
							target="_blank"
						>
							<ExternalLink className="h-4 w-4" />
							<span className="sr-only">Visit Website</span>
						</a>
					</Button>
				)}

				{/* Menu */}
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
							<DropdownMenuItem asChild className="sm:hidden">
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

			{/* Progress Bar (Thicker & Always Visible) */}
			<div className="absolute right-0 bottom-0 left-0 h-1 w-full bg-secondary/30">
				<div
					className="h-full bg-primary/40 transition-all duration-500"
					style={{ width: `${progress}%` }}
				/>
			</div>
		</div>
	);
}
