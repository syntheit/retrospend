"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useExpenseModal } from "~/components/expense-modal-provider";
import { ConfirmationDialog } from "~/components/ui/confirmation-dialog";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { api } from "~/trpc/react";
import {
	RecentExpenses,
	type ActivityItem,
} from "../../_components/recent-expenses";
import { useDashboardContext } from "../_lib/dashboard-context";
import type { WidgetProps } from "../_lib/widget-registry";

export default function RecentActivityWidget(_props: WidgetProps) {
	const t = useTranslations("dashboard");
	const { data, isLoading } = useDashboardContext();
	const { formatCurrency } = useCurrencyFormatter();
	const { openExpense, openSharedExpense } = useExpenseModal();
	const router = useRouter();
	const utils = api.useUtils();

	const [pendingDeleteItem, setPendingDeleteItem] =
		useState<ActivityItem | null>(null);

	const deleteMutation = api.expense.deleteExpense.useMutation({
		onSuccess: async () => {
			toast.success(t("expenseDeleted"));
			await utils.dashboard.getRecentActivity.invalidate();
			setPendingDeleteItem(null);
		},
		onError: () => {
			toast.error(t("expenseDeleteFailed"));
		},
	});

	const handleActivityClick = useCallback(
		(item: ActivityItem) => {
			if (item.type === "personal") {
				openExpense(item.id);
			} else if (item.type === "shared") {
				if (item.sharedContext?.projectId) {
					router.push(`/projects/${item.sharedContext.projectId}`);
				} else if (item.sharedContext?.transactionId) {
					openSharedExpense(item.sharedContext.transactionId);
				}
			} else if (item.type === "settlement") {
				router.push("/people");
			}
		},
		[openExpense, openSharedExpense, router],
	);

	return (
		<>
			{/* Height-constrained wrapper — RecentExpenses uses lg:h-full internally */}
			<div className="h-[420px]">
				<RecentExpenses
					activityLoading={isLoading.activity}
					formatCurrency={formatCurrency}
					homeCurrency={data.homeCurrency}
					liveRateToBaseCurrency={data.liveRateToBaseCurrency}
					onDeleteItem={setPendingDeleteItem}
					onItemClick={handleActivityClick}
					recentActivity={data.recentActivity}
				/>
			</div>
			<ConfirmationDialog
				confirmLabel={t("deleteExpenseConfirm")}
				description={t("deleteExpenseDescription")}
				isLoading={deleteMutation.isPending}
				onConfirm={() => {
					if (pendingDeleteItem) {
						deleteMutation.mutate({ id: pendingDeleteItem.id });
					}
				}}
				onOpenChange={(open) => {
					if (!open) setPendingDeleteItem(null);
				}}
				open={pendingDeleteItem !== null}
				title={t("deleteExpenseTitle")}
				variant="destructive"
			/>
		</>
	);
}
