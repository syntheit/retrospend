"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { api } from "~/trpc/react";
import { DataExport } from "./data-export";

export function ExpensesExportTab() {
	const t = useTranslations("dataManagement");
	const exportMutation = api.expense.exportCsv.useMutation();

	const handleExport = async () => {
		try {
			const { csv } = await exportMutation.mutateAsync({});
			const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = `expenses-${new Date().toISOString().slice(0, 10)}.csv`;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);
			toast.success(t("csvExported"));
		} catch (error: unknown) {
			toast.error(
				error instanceof Error ? error.message : t("failedToExportCsv"),
			);
		}
	};

	return (
		<DataExport
			description={t("expensesExportDescription")}
			isExporting={exportMutation.isPending}
			onExport={handleExport}
			title={t("expenses")}
		/>
	);
}
