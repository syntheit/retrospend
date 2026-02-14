"use client";

import { Download, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
import { type ParsedBudgetRow, parseBudgetCsv } from "~/lib/csv";
import { api } from "~/trpc/react";

interface BudgetPreview {
	id: string;
	categoryName?: string;
	amount: number;
	period: Date;
	isRollover: boolean;
	rolloverAmount: number;
	pegToActual: boolean;
}

export function BudgetsTab() {
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const [previewData, setPreviewData] = useState<BudgetPreview[]>([]);
	const [parseError, setParseError] = useState<string | null>(null);

	const exportMutation = api.budget.exportCsv.useMutation();
	const importMutation = api.budget.importBudgets.useMutation();

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
			toast.success("Budgets exported");
		} catch (error: unknown) {
			toast.error(
				error instanceof Error ? error.message : "Failed to export budgets",
			);
		}
	};

	const buildPreview = (rows: ParsedBudgetRow[]): BudgetPreview[] => {
		return rows.map((row, index) => {
			const date = new Date(row.period);
			return {
				id: `preview-${index}`,
				categoryName: row.categoryName ?? undefined,
				amount: Number(row.amount) || 0,
				period: Number.isNaN(date.getTime()) ? new Date() : date,
				isRollover: row.isRollover,
				rolloverAmount: Number(row.rolloverAmount) || 0,
				pegToActual: row.pegToActual,
			};
		});
	};

	const handleFileChange = async (
		event: React.ChangeEvent<HTMLInputElement>,
	) => {
		const file = event.target.files?.[0];
		if (!file) return;

		try {
			const text = await file.text();
			const result = parseBudgetCsv(text);

			if (result.errors.length > 0) {
				setParseError(result.errors.join("\n"));
				setPreviewData([]);
				return;
			}

			setParseError(null);
			setPreviewData(buildPreview(result.rows));
			toast.success(
				`Loaded ${result.rows.length} row${result.rows.length === 1 ? "" : "s"} for import`,
			);
		} catch (error: unknown) {
			setParseError(
				error instanceof Error ? error.message : "Failed to read CSV file.",
			);
			setPreviewData([]);
		} finally {
			if (fileInputRef.current) {
				fileInputRef.current.value = "";
			}
		}
	};

	const handleImport = async () => {
		if (previewData.length === 0) return;
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
			setPreviewData([]);
		} catch (error: unknown) {
			toast.error(
				error instanceof Error ? error.message : "Failed to import budgets",
			);
		}
	};

	return (
		<div className="space-y-6 pt-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="space-y-1">
					<p className="font-medium">Export budgets</p>
					<p className="text-muted-foreground text-sm">
						Downloads all budgets as a CSV file.
					</p>
				</div>
				<Button
					className="w-full sm:w-auto"
					disabled={exportMutation.isPending}
					onClick={handleExport}
					variant="outline"
				>
					{exportMutation.isPending ? "Preparing..." : "Download CSV"}
					<Download className="ml-2 h-4 w-4" />
				</Button>
			</div>

			<Separator />

			<div className="space-y-4">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div className="space-y-1">
						<p className="font-medium">Import budgets</p>
						<p className="text-muted-foreground text-sm">
							Upload a CSV to update or create budgets.
						</p>
					</div>
					<div className="flex flex-col gap-2 sm:flex-row">
						<Button
							className="w-full sm:w-auto"
							onClick={() => fileInputRef.current?.click()}
							variant="secondary"
						>
							Select CSV
							<Upload className="ml-2 h-4 w-4" />
						</Button>
						<Button
							className="w-full sm:w-auto"
							disabled={previewData.length === 0 || importMutation.isPending}
							onClick={handleImport}
						>
							{importMutation.isPending
								? "Importing..."
								: `Import ${previewData.length || ""} ${previewData.length === 1 ? "row" : "rows"}`}
						</Button>
					</div>
				</div>
				<div className="space-y-2 rounded-lg border bg-muted/30 p-4">
					<Label className="font-medium text-sm">CSV format</Label>
					<p className="text-muted-foreground text-sm leading-relaxed">
						Required: <code className="text-primary">amount</code>,{" "}
						<code className="text-primary">period (YYYY-MM-DD)</code>. <br />
						Optional:{" "}
						<code className="text-muted-foreground">categoryName</code>,{" "}
						<code className="text-muted-foreground">isRollover</code>,{" "}
						<code className="text-muted-foreground">pegToActual</code>.
					</p>
				</div>
				{parseError && (
					<div className="whitespace-pre-wrap rounded-md border border-destructive/50 bg-destructive/10 p-3 font-mono text-destructive text-sm">
						{parseError}
					</div>
				)}
				<Input
					accept=".csv,text/csv"
					className="hidden"
					onChange={handleFileChange}
					ref={fileInputRef}
					type="file"
				/>
				{previewData.length > 0 && (
					<div className="space-y-3">
						<div className="flex items-center justify-between">
							<p className="font-medium">Preview ({previewData.length} rows)</p>
							<Button
								onClick={() => setPreviewData([])}
								size="sm"
								variant="ghost"
							>
								Clear
							</Button>
						</div>
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
									{previewData.map((row) => (
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
					</div>
				)}
			</div>
		</div>
	);
}
