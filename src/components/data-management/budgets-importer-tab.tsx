"use client";

import { useMemo } from "react";
import { toast } from "sonner";
import { parseBudgetCsv } from "~/lib/csv";
import { api } from "~/trpc/react";
import { DataImporter } from "./data-importer";

interface BudgetPreview {
	id: string;
	categoryName?: string;
	amount: number;
	period: Date;
	isRollover: boolean;
	rolloverAmount: number;
	pegToActual: boolean;
}

export function BudgetsImporterTab({ isActive = true }: { isActive?: boolean }) {
	const importMutation = api.budget.importBudgets.useMutation();

	const handleParseCsv = (
		text: string,
	): { rows: BudgetPreview[]; errors: string[] } => {
		const result = parseBudgetCsv(text);
		if (result.errors.length > 0) return { rows: [], errors: result.errors };

		const rows: BudgetPreview[] = result.rows.map((row, index) => {
			return {
				id: `preview-${index}`,
				categoryName: row.categoryName ?? undefined,
				amount: Number(row.amount) || 0,
				period: row.period,
				isRollover: row.isRollover,
				rolloverAmount: Number(row.rolloverAmount) || 0,
				pegToActual: row.pegToActual,
			};
		});

		return { rows, errors: [] };
	};

	const handleImport = async (previewData: BudgetPreview[]) => {
		try {
			const rows = previewData.map((item) => ({
				categoryName: item.categoryName,
				amount: item.amount,
				period: item.period,
				isRollover: item.isRollover,
				rolloverAmount: item.rolloverAmount,
				pegToActual: item.pegToActual,
			}));

			const result = await importMutation.mutateAsync({ rows });
			toast.success(
				`Imported: ${result.successCount} success, ${result.skippedCount} skipped`,
			);
		} catch (error: unknown) {
			toast.error(
				error instanceof Error ? error.message : "Failed to import budgets",
			);
			throw error;
		}
	};

	const Preview = useMemo(() => {
		const BudgetPreviewTable = ({ data }: { data: BudgetPreview[] }) => {
			return (
				<div className="max-h-[300px] overflow-auto rounded-md border">
					<table className="w-full text-sm">
						<thead className="sticky top-0 bg-muted/50">
							<tr className="border-b transition-colors hover:bg-muted/50">
								<th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
									Category
								</th>
								<th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
									Amount
								</th>
								<th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
									Period
								</th>
								<th className="h-10 px-4 text-left align-middle font-medium text-muted-foreground">
									Options
								</th>
							</tr>
						</thead>
						<tbody className="[&_tr:last-child]:border-0">
							{data.map((row) => (
								<tr
									className="border-b transition-colors hover:bg-muted/50"
									key={row.id}
								>
									<td className="p-4 align-middle">
										{row.categoryName || (
											<span className="text-muted-foreground italic">
												Global
											</span>
										)}
									</td>
									<td className="p-4 align-middle">{row.amount}</td>
									<td className="p-4 align-middle">
										{row.period.toISOString().slice(0, 7)}
									</td>
									<td className="p-4 align-middle text-muted-foreground text-xs">
										{row.isRollover && "Rollover"}
										{row.isRollover && row.pegToActual && ", "}
										{row.pegToActual && "Pegged"}
										{!row.isRollover && !row.pegToActual && "-"}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			);
		};
		BudgetPreviewTable.displayName = "BudgetPreviewTable";
		return BudgetPreviewTable;
	}, []);

	return (
		<DataImporter
			formatInfo={
				<p>
					Required: <code className="text-primary">amount</code>,{" "}
					<code className="text-primary">period (YYYY-MM-DD)</code>. <br />
					Optional: <code className="text-muted-foreground">categoryName</code>,{" "}
					<code className="text-muted-foreground">isRollover</code>,{" "}
					<code className="text-muted-foreground">pegToActual</code>.
				</p>
			}
			isActive={isActive}
			isImporting={importMutation.isPending}
			onImport={handleImport}
			parseCsv={handleParseCsv}
			renderPreview={Preview}
			sampleData={[
				"amount,period,categoryName,isRollover,pegToActual",
				"500,2024-01-01,Groceries,true,false",
				"100,2024-01-01,Dining,false,true",
			].join("\n")}
			sampleFilename="budgets_sample.csv"
			title="Budgets"
		/>
	);
}
