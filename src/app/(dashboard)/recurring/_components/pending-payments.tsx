"use client";

import { AlertTriangle, Check } from "lucide-react";
import { BrandIcon } from "~/components/ui/BrandIcon";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { formatExpenseDate } from "~/lib/format";
import type { RecurringTemplate } from "~/types/recurring";

interface PendingPaymentsProps {
	pendingTemplates: RecurringTemplate[];
	onConfirm: (id: string) => void;
	confirmingId: string | null;
}

export function PendingPayments({
	pendingTemplates,
	onConfirm,
	confirmingId,
}: PendingPaymentsProps) {
	const { formatCurrency } = useCurrencyFormatter();

	return (
		<div className="overflow-hidden rounded-xl border border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20">
			<div className="flex items-center gap-2 border-amber-500/20 border-b px-4 py-3">
				<AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
				<h3 className="font-semibold text-amber-900 text-sm dark:text-amber-200">
					{pendingTemplates.length} payment
					{pendingTemplates.length !== 1 ? "s" : ""} need
					{pendingTemplates.length === 1 ? "s" : ""} confirmation
				</h3>
			</div>
			<div className="divide-y divide-amber-500/10">
				{pendingTemplates.map((template) => (
					<div
						className="flex items-center gap-3 px-4 py-3"
						key={template.id}
					>
						<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100/50 dark:bg-amber-900/30">
							<BrandIcon
								className="h-5 w-5 rounded-full"
								name={template.name}
								size={20}
								url={template.websiteUrl}
							/>
						</div>
						<div className="min-w-0 flex-1">
							<div className="flex items-center gap-2">
								<span className="truncate font-medium text-sm">
									{template.name}
								</span>
								<Badge
									className="border-amber-500/30 bg-amber-100 text-[10px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
									variant="outline"
								>
									Pending
								</Badge>
							</div>
							<p className="text-muted-foreground text-xs">
								Due {formatExpenseDate(new Date(template.nextDueDate))}
							</p>
						</div>
						<span className="shrink-0 font-semibold text-sm tabular-nums">
							{formatCurrency(Number(template.amount), template.currency)}
						</span>
						<Button
							disabled={confirmingId === template.id}
							onClick={() => onConfirm(template.id)}
							size="sm"
							variant="outline"
						>
							{confirmingId === template.id ? (
								"Confirming..."
							) : (
								<>
									<Check className="mr-1 h-3.5 w-3.5" />
									Confirm
								</>
							)}
						</Button>
					</div>
				))}
			</div>
		</div>
	);
}
