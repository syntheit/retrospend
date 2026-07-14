"use client";

import { differenceInDays } from "date-fns";
import { CalendarDays, Check } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo } from "react";
import { toast } from "sonner";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { Skeleton } from "~/components/ui/skeleton";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { useCurrency } from "~/hooks/use-currency";
import { getCategoryIcon } from "~/lib/category-icons";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import { useDashboardContext } from "../_lib/dashboard-context";
import type { WidgetProps } from "../_lib/widget-registry";


export default function UpcomingRecurringWidget(_props: WidgetProps) {
	const t = useTranslations("recurring");
	const td = useTranslations("dashboard");
	const { state } = useDashboardContext();
	const { homeCurrency } = useCurrency();
	const { formatCurrency } = useCurrencyFormatter();
	const utils = api.useUtils();

	const { data: templates, isLoading } = api.recurring.list.useQuery({
		includeInactive: false,
	});

	const confirmMutation = api.recurring.confirmAndCreate.useMutation({
		onSuccess: () => {
			toast.success(t("paymentConfirmed"));
			void utils.recurring.list.invalidate();
			void utils.dashboard.getRecentActivity.invalidate();
		},
	});

	const now = state.serverTime ?? state.now;

	const upcoming = useMemo(() => {
		if (!templates) return [];
		return templates
			.filter((tpl) => tpl.isActive && tpl.nextDueDate)
			.sort(
				(a, b) =>
					new Date(a.nextDueDate!).getTime() -
					new Date(b.nextDueDate!).getTime(),
			)
			.slice(0, 5)
			.map((tpl) => {
				const dueDate = new Date(tpl.nextDueDate!);
				const daysUntil = differenceInDays(dueDate, now);
				return { ...tpl, daysUntil };
			});
	}, [templates, now]);

	if (isLoading) {
		return (
			<div className="space-y-2">
				<Skeleton className="h-12 w-full" />
				<Skeleton className="h-12 w-full" />
				<Skeleton className="h-12 w-full" />
			</div>
		);
	}

	if (upcoming.length === 0) {
		return (
			<EmptyState
				description={t("noUpcomingPaymentsDescription")}
				icon={CalendarDays}
				title={t("noPaymentsDue")}
				action={{
					label: t("title"),
					href: "/recurring",
				}}
			/>
		);
	}

	return (
		<div className="divide-y divide-border">
			{upcoming.map((item) => {
				const Icon = getCategoryIcon(
					item.category?.name ?? "Uncategorized",
				);
				const isPastDue = item.daysUntil < 0;
				const isDueToday = item.daysUntil === 0;

				return (
					<div
						className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
						key={item.id}
					>
						<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
							<Icon className="h-4 w-4 text-muted-foreground" />
						</div>
						<div className="min-w-0 flex-1">
							<div className="truncate font-medium text-sm">
								{item.name}
							</div>
							<div className="text-muted-foreground text-xs tabular-nums">
								{formatCurrency(Number(item.amount), item.currency ?? homeCurrency)}
							</div>
						</div>
						<div className="flex shrink-0 items-center gap-2">
							<Badge
								className={cn(
									"text-xs",
									isPastDue
										? "bg-rose-500/10 text-rose-500"
										: isDueToday
											? "bg-amber-500/10 text-amber-500"
											: "bg-muted text-muted-foreground",
								)}
								variant="secondary"
							>
								{isPastDue
									? td("widgets.upcomingRecurringWidget.daysOverdue", {
											days: Math.abs(item.daysUntil),
										})
									: isDueToday
										? td("widgets.upcomingRecurringWidget.today")
										: td("widgets.upcomingRecurringWidget.inDays", {
												days: item.daysUntil,
											})}
							</Badge>
							{!item.autoPay && item.daysUntil <= 0 && (
								<Button
									className="h-7"
									disabled={confirmMutation.isPending}
									onClick={() =>
										confirmMutation.mutate({ id: item.id })
									}
									size="sm"
									variant="outline"
								>
									<Check className="mr-1 h-3 w-3" />
									{td("widgets.upcomingRecurringWidget.confirm")}
								</Button>
							)}
						</div>
					</div>
				);
			})}
			<div className="pt-2">
				<Button asChild className="w-full" size="sm" variant="ghost">
					<Link href="/recurring">{t("title")}</Link>
				</Button>
			</div>
		</div>
	);
}
