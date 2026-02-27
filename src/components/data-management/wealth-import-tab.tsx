"use client";

import { useMemo } from "react";
import { toast } from "sonner";
import { type ParsedWealthRow, parseWealthCsv } from "~/lib/csv";
import { api } from "~/trpc/react";
import type { AssetType } from "~prisma";
import { DataImport } from "./data-import";

export function WealthImportTab() {
	const importMutation = api.wealth.importAssets.useMutation();

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
				`Imported: ${result.successCount} success, ${result.errorCount} failed`,
			);
		} catch (error: unknown) {
			toast.error(
				error instanceof Error ? error.message : "Failed to import wealth data",
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
									Name
								</th>
								<th className="h-8 px-2 text-left align-middle font-medium text-muted-foreground">
									Balance
								</th>
								<th className="h-8 px-2 text-left align-middle font-medium text-muted-foreground">
									Currency
								</th>
								<th className="h-8 px-2 text-left align-middle font-medium text-muted-foreground">
									Type
								</th>
								<th className="h-8 px-2 text-left align-middle font-medium text-muted-foreground">
									Liquid
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
										{row.isLiquid ? "Yes" : "No"}
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
	}, []);

	return (
		<DataImport
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
			isImporting={importMutation.isPending}
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
			title="Wealth"
		/>
	);
}
