"use client";

import { useTranslations } from "next-intl";
import { Badge } from "~/components/ui/badge";

interface TransactionStatusBadgeProps {
	status: string;
}

export function TransactionStatusBadge({
	status,
}: TransactionStatusBadgeProps) {
	const t = useTranslations("common");
	switch (status) {
		case "active":
			return (
				<Badge
					className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
					variant="outline"
				>
					{t("statusConfirmed")}
				</Badge>
			);
		case "pending":
			return (
				<Badge
					className="bg-amber-500/10 text-amber-600 dark:text-amber-400"
					variant="outline"
				>
					{t("statusNeedsReview")}
				</Badge>
			);
		case "settled":
			return (
				<Badge className="text-muted-foreground" variant="outline">
					{t("statusSettled")}
				</Badge>
			);
		default:
			return <Badge variant="outline">{status}</Badge>;
	}
}
