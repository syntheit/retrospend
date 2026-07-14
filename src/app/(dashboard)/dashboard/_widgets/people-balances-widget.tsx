"use client";

import { ArrowDownLeft, ArrowUpRight, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useMemo } from "react";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { Skeleton } from "~/components/ui/skeleton";
import { UserAvatar } from "~/components/ui/user-avatar";
import { useCurrency } from "~/hooks/use-currency";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import type { WidgetProps } from "../_lib/widget-registry";

export default function PeopleBalancesWidget(_props: WidgetProps) {
	const t = useTranslations("people");
	const { homeCurrency } = useCurrency();
	const { formatCurrency } = useCurrencyFormatter();

	const { data: people, isLoading } = api.people.list.useQuery();

	const topBalances = useMemo(() => {
		if (!people) return [];
		return people
			.filter((p) => {
				const totalBalance = p.balances.reduce(
					(sum, b) => sum + b.balance,
					0,
				);
				return totalBalance > 0;
			})
			.slice(0, 3);
	}, [people]);

	if (isLoading) {
		return (
			<div className="space-y-2">
				<Skeleton className="h-12 w-full" />
				<Skeleton className="h-12 w-full" />
				<Skeleton className="h-12 w-full" />
			</div>
		);
	}

	if (topBalances.length === 0) {
		return (
			<EmptyState
				description={t("noSharedDescription")}
				icon={Users}
				title={t("noSharedExpenses")}
			/>
		);
	}

	return (
		<div className="divide-y divide-border">
			{topBalances.map((person) => {
				const primaryBalance = person.balances[0];
				if (!primaryBalance) return null;

				const isOwed = primaryBalance.direction === "they_owe_you";
				const amount = primaryBalance.balance;
				const currency = primaryBalance.currency ?? homeCurrency;

				return (
					<div
						className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
						key={person.identity.participantId}
					>
						<UserAvatar
							avatarUrl={person.identity.avatarUrl}
							name={person.identity.name ?? "?"}
							size="sm"
						/>
						<div className="min-w-0 flex-1">
							<div className="truncate font-medium text-sm">
								{person.identity.name}
							</div>
							<div className="text-muted-foreground text-xs">
								{isOwed ? t("theyOweYou") : t("youOweThem")}
							</div>
						</div>
						<div className="flex items-center gap-1.5 shrink-0">
							<span
								className={cn(
									"font-medium text-sm tabular-nums",
									isOwed
										? "text-emerald-500"
										: "text-rose-500",
								)}
							>
								{isOwed ? "+" : "-"}
								{formatCurrency(amount, currency)}
							</span>
							{isOwed ? (
								<ArrowDownLeft className="h-3.5 w-3.5 text-emerald-500" />
							) : (
								<ArrowUpRight className="h-3.5 w-3.5 text-rose-500" />
							)}
						</div>
					</div>
				);
			})}
			<div className="pt-2">
				<Button asChild className="w-full" size="sm" variant="ghost">
					<Link href="/people">{t("viewHistory")}</Link>
				</Button>
			</div>
		</div>
	);
}
