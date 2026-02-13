"use client";

import { Download, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
import { type ParsedWealthRow, parseWealthCsv } from "~/lib/csv";
import { api } from "~/trpc/react";
import { AssetType } from "~prisma";

export function WealthTab() {
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const [previewData, setPreviewData] = useState<ParsedWealthRow[]>([]);
	const [parseError, setParseError] = useState<string | null>(null);

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
			toast.success("Wealth data exported");
		} catch (error: unknown) {
			toast.error(
				error instanceof Error ? error.message : "Failed to export wealth data",
			);
		}
	};

	const handleFileChange = async (
		event: React.ChangeEvent<HTMLInputElement>,
	) => {
		const file = event.target.files?.[0];
		if (!file) return;

		try {
			const text = await file.text();
			const result = parseWealthCsv(text);

			if (result.errors.length > 0) {
				setParseError(result.errors.join("\n"));
				setPreviewData([]);
				return;
			}

			setParseError(null);
			setPreviewData(result.rows);
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
			const result = await importMutation.mutateAsync({
				rows: previewData.map((r) => ({
					...r,
					type: r.type as AssetType,
				})),
			});
			toast.success(
				`Imported: ${result.successCount} success, ${result.errorCount} failed`,
			);
			setPreviewData([]);
		} catch (error: unknown) {
			toast.error(
				error instanceof Error ? error.message : "Failed to import wealth data",
			);
		}
	};

	return (
		<div className="space-y-6 pt-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="space-y-1">
					<p className="font-medium">Export wealth</p>
					<p className="text-muted-foreground text-sm">
						Downloads all assets and liabilities as a CSV file.
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
						<p className="font-medium">Import wealth</p>
						<p className="text-muted-foreground text-sm">
							Upload a CSV to update or create wealth items.
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
				<div className="rounded-lg border bg-muted/30 p-4 space-y-2">
					<Label className="font-medium text-sm">CSV format</Label>
					<p className="text-muted-foreground text-sm leading-relaxed">
						Required: <code className="text-primary">name</code>,{" "}
						<code className="text-primary">balance</code>,{" "}
						<code className="text-primary">currency</code>,{" "}
						<code className="text-primary">type</code>. <br />
						Types:{" "}
						<code className="text-muted-foreground text-[10px]">
							CASH, INVESTMENT, CRYPTO, REAL_ESTATE, VEHICLE, LIABILITY_LOAN,
							LIABILITY_CREDIT_CARD, LIABILITY_MORTGAGE
						</code>
						.
					</p>
				</div>
				{parseError && (
					<div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-destructive text-sm font-mono whitespace-pre-wrap">
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
									{previewData.map((row) => (
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
					</div>
				)}
			</div>
		</div>
	);
}
