"use client";

import { toast } from "sonner";
import { api } from "~/trpc/react";
import { DataExport } from "./data-export";

export function WealthExportTab() {
	const exportMutation = api.wealth.exportCsv.useMutation();

	const handleExport = async () => {
		try {
			const { csv } = await exportMutation.mutateAsync();
			const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = `wealth-${new Date().toISOString().slice(0, 10)}.csv`;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);
			toast.success("Wealth data exported");
		} catch (error: unknown) {
			toast.error(
				error instanceof Error ? error.message : "Failed to export wealth data",
			);
		}
	};

	return (
		<DataExport
			description="Downloads all assets and liabilities as a CSV file."
			isExporting={exportMutation.isPending}
			onExport={handleExport}
			title="Wealth"
		/>
	);
}
