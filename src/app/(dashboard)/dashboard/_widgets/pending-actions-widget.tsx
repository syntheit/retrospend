"use client";

import { CalendarDays, CheckCircle2, Receipt, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo } from "react";
import { Badge } from "~/components/ui/badge";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import { useDashboardContext } from "../_lib/dashboard-context";
import type { WidgetProps } from "../_lib/widget-registry";

interface ActionItem {
	id: string;
	type: "recurring" | "verification" | "settlement";
	label: string;
	href: string;
	icon: typeof Receipt;
}

export default function PendingActionsWidget(_props: WidgetProps) {
	const t = useTranslations("dashboard");
	const { state } = useDashboardContext();

	const { data: templates, isLoading: recurringLoading } =
		api.recurring.list.useQuery({ includeInactive: false });

	const { data: people, isLoading: peopleLoading } =
		api.people.list.useQuery();

	const isLoading = recurringLoading || peopleLoading;
	const now = state.serverTime ?? state.now;

	const actions = useMemo<ActionItem[]>(() => {
		const items: ActionItem[] = [];

		if (templates) {
			const pending = templates.filter(
				(tpl) =>
					tpl.isActive &&
					!tpl.autoPay &&
					tpl.nextDueDate &&
					new Date(tpl.nextDueDate) <= now,
			);
			for (const tpl of pending.slice(0, 3)) {
				items.push({
					id: `recurring-${tpl.id}`,
					type: "recurring",
					label: t("widgets.pendingActionsWidget.confirmPrefix", {
						name: tpl.name,
					}),
					href: "/recurring",
					icon: CalendarDays,
				});
			}
		}

		if (people) {
			const withUnseen = people.filter(
				(p) => (p.unseenChangesCount ?? 0) > 0,
			);
			for (const person of withUnseen.slice(0, 3)) {
				items.push({
					id: `verify-${person.identity.participantId}`,
					type: "verification",
					label: t("widgets.pendingActionsWidget.reviewPrefix", {
						name: person.identity.name,
					}),
					href: "/people",
					icon: Users,
				});
			}
		}

		return items.slice(0, 5);
	}, [templates, people, now, t]);

	if (isLoading) {
		return (
			<div className="space-y-2">
				<Skeleton className="h-10 w-full" />
				<Skeleton className="h-10 w-full" />
			</div>
		);
	}

	if (actions.length === 0) {
		return (
			<div className="flex flex-col items-center gap-2 py-4 text-center">
				<CheckCircle2 className="h-8 w-8 text-emerald-500" />
				<p className="font-medium text-sm">
					{t("widgets.pendingActionsWidget.allCaughtUp")}
				</p>
				<p className="text-muted-foreground text-xs">
					{t("widgets.pendingActionsWidget.noPendingActions")}
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-1">
			<div className="flex items-center gap-2 pb-1">
				<Badge variant="secondary">{actions.length}</Badge>
				<span className="text-muted-foreground text-xs">
					{t("widgets.pendingActionsWidget.itemsNeedAttention", {
						count: actions.length,
					})}
				</span>
			</div>
			<div className="divide-y divide-border">
				{actions.map((action) => {
					const Icon = action.icon;
					return (
						<Link
							className="flex items-center gap-3 rounded-md py-2 transition-colors hover:bg-accent/50"
							href={action.href}
							key={action.id}
						>
							<div
								className={cn(
									"flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
									action.type === "recurring"
										? "bg-amber-500/10 text-amber-500"
										: action.type === "verification"
											? "bg-blue-500/10 text-blue-500"
											: "bg-violet-500/10 text-violet-500",
								)}
							>
								<Icon className="h-3.5 w-3.5" />
							</div>
							<span className="truncate text-sm">{action.label}</span>
						</Link>
					);
				})}
			</div>
		</div>
	);
}
