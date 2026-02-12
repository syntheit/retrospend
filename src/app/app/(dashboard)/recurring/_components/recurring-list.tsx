"use client";

import { format } from "date-fns";
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
import { cn } from "~/lib/utils";

interface RecurringTemplate {
	id: string;
	name: string;
	amount: number;
	amountInHomeCurrency: number;
	currency: string;
	exchangeRate: number;
	frequency: "WEEKLY" | "MONTHLY" | "YEARLY";
	nextDueDate: Date;
	websiteUrl?: string | null;
	isActive: boolean;
}

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
					Add Expense
				</Button>
			</div>
		);
	}

	return (
		<div className="space-y-2">
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
	const frequencyLabel = {
		WEEKLY: "Weekly",
		MONTHLY: "Monthly",
		YEARLY: "Yearly",
	}[template.frequency];

	const nextDate = new Date(template.nextDueDate);
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const isOverdue = nextDate < today;
	const isToday = nextDate.toDateString() === today.toDateString();

	return (
		<div className="flex items-center gap-4 rounded-lg border bg-card p-4 transition-colors hover:bg-accent/50">
			{/* Icon */}
			<BrandIcon
				className="h-10 w-10 shrink-0 rounded-full"
				name={template.name}
				url={template.websiteUrl}
			/>

			{/* Details */}
			<div className="min-w-0 flex-1">
				<div className="flex items-baseline gap-2">
					<h4 className="truncate font-semibold">{template.name}</h4>
					<span className="shrink-0 text-muted-foreground text-xs">
						{frequencyLabel}
					</span>
				</div>
				<p
					className={cn(
						"text-sm",
						isOverdue || isToday
							? "font-medium text-destructive"
							: "text-muted-foreground",
					)}
				>
					Next: {format(nextDate, "MMM d, yyyy")}
					{isToday && " (Today)"}
					{isOverdue && " (Overdue)"}
				</p>
			</div>

			{/* Amount */}
			<div className="shrink-0 text-right">
				<p className="font-semibold">
					{formatCurrency(Number(template.amount), template.currency)}
				</p>
			</div>

			{/* Actions */}
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button size="icon" variant="ghost">
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
	);
}
