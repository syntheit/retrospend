"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { toast } from "sonner";
import { type ParsedWealthRow, parseWealthCsv } from "~/lib/csv";
import { api } from "~/trpc/react";
import type { AssetType } from "~prisma";
import { DataImporterExport } from "./data-importer-export";

export function WealthTab() {
	const t = useTranslations("dataManagement");
	const exportMutation = api.wealth.exportCsv.useMutation();
	const importMutation = api.wealth.importAssets.useMutation();

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
			toast.success(t("wealthDataExported"));
		} catch (error: unknown) {
			toast.error(
				error instanceof Error ? error.message : t("failedToExportWealthData"),
			);
		}
	};

	const handleParseCsv = (
		text: string,
	): { rows: ParsedWealthRow[]; errors: string[] } => {
		return parseWealthCsv(text);
	};

	const handleImport = async (previewData: ParsedWealthRow[]) => {
		try {
			const result = await importMutation.mutateAsync({
				rows: previewData.map((r) => ({
					...r,
					type: r.type as AssetType,
				})),
			});
			toast.success(
				t("importedSuccessFailed", { success: result.successCount, failed: result.errorCount }),
			);
		} catch (error: unknown) {
			toast.error(
				error instanceof Error ? error.message : t("failedToImportWealthData"),
			);
			throw error;
		}
	};

	const Preview = useMemo(() => {
		const WealthPreviewTable = ({ data }: { data: ParsedWealthRow[] }) => {
			return (
				<div className="max-h-[300px] overflow-auto rounded-md border text-xs">
					<table className="w-full text-xs">
						<thead className="sticky top-0 bg-muted/50">
							<tr className="border-b transition-colors hover:bg-muted/50">
								<th className="h-8 px-2 text-left align-middle font-medium text-muted-foreground">
									{t("name")}
								</th>
								<th className="h-8 px-2 text-left align-middle font-medium text-muted-foreground">
									{t("balance")}
								</th>
								<th className="h-8 px-2 text-left align-middle font-medium text-muted-foreground">
									{t("currency")}
								</th>
								<th className="h-8 px-2 text-left align-middle font-medium text-muted-foreground">
									{t("type")}
								</th>
								<th className="h-8 px-2 text-left align-middle font-medium text-muted-foreground">
									{t("liquid")}
								</th>
							</tr>
						</thead>
						<tbody className="[&_tr:last-child]:border-0">
							{data.map((row) => (
								<tr
									className="border-b transition-colors hover:bg-muted/50"
									key={row.name}
								>
									<td className="p-2 align-middle">{row.name}</td>
									<td className="p-2 align-middle">{row.balance}</td>
									<td className="p-2 align-middle">{row.currency}</td>
									<td className="p-2 align-middle">{row.type}</td>
									<td className="p-2 align-middle">
										{row.isLiquid ? t("yes") : t("no")}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			);
		};
		WealthPreviewTable.displayName = "WealthPreviewTable";
		return WealthPreviewTable;
	}, [t]);

	return (
		<DataImporterExport
			description={t("wealthExportDescription")}
			formatInfo={
				<p>
					Required: <code className="text-primary">name</code>,{" "}
					<code className="text-primary">balance</code>,{" "}
					<code className="text-primary">currency</code>,{" "}
					<code className="text-primary">type</code>. <br />
					Types:{" "}
					<code className="text-[10px] text-muted-foreground">
						CASH, INVESTMENT, CRYPTO, REAL_ESTATE, VEHICLE, LIABILITY_LOAN,
						LIABILITY_CREDIT_CARD, LIABILITY_MORTGAGE
					</code>
					.
				</p>
			}
			isExporting={exportMutation.isPending}
			isImporting={importMutation.isPending}
			onExport={handleExport}
			onImport={handleImport}
			parseCsv={handleParseCsv}
			renderPreview={Preview}
			sampleData={[
				"name,balance,currency,type,isLiquid",
				"Cash in Wallet,100,USD,CASH,true",
				"Savings Account,5000,EUR,CASH,true",
				"Tesla Stock,2000,USD,INVESTMENT,false",
			].join("\n")}
			sampleFilename="wealth_sample.csv"
			title={t("wealth")}
		/>
	);
}
