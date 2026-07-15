"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { api } from "~/trpc/react";
import { DataExport } from "./data-export";

export function BudgetsExportTab() {
	const t = useTranslations("dataManagement");
	const exportMutation = api.budget.exportCsv.useMutation();

	const handleExport = async () => {
		try {
			const { csv } = await exportMutation.mutateAsync();
			const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = `budgets-${new Date().toISOString().slice(0, 10)}.csv`;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);
			toast.success(t("budgetsExported"));
		} catch (error: unknown) {
			toast.error(
				error instanceof Error ? error.message : t("failedToExportBudgets"),
			);
		}
	};

	return (
		<DataExport
			description={t("budgetsExportDescription")}
			isExporting={exportMutation.isPending}
			onExport={handleExport}
			title={t("budgets")}
		/>
	);
}
