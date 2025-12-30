"use client";

import { Download, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { DataTable } from "~/components/data-table";
import { Button } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
import { type ParsedCsvRow, parseCsv } from "~/lib/csv";
import { generateId, type NormalizedExpense } from "~/lib/utils";
import { api } from "~/trpc/react";

export function CsvImportExportCard() {
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const [previewData, setPreviewData] = useState<NormalizedExpense[]>([]);
	const [parseError, setParseError] = useState<string | null>(null);

	const { data: settings } = api.user.getSettings.useQuery();
	const { data: categories } = api.user.listCategories.useQuery();

	const exportMutation = api.expense.exportCsv.useMutation();
	const importMutation = api.expense.importExpenses.useMutation();

	const categoryLookup = useMemo(() => {
		const map = new Map<string, NonNullable<typeof categories>[number]>();
		(categories ?? []).forEach((category) => {
			map.set(category.name.toLowerCase(), category);
		});
		return map;
	}, [categories]);

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
			toast.success("CSV exported");
		} catch (error: unknown) {
			toast.error(error instanceof Error ? error.message : "Failed to export CSV");
		}
	};

	const buildPreview = (rows: ParsedCsvRow[]): NormalizedExpense[] => {
		return rows.map((row) => {
			const matchedCategory = row.categoryName
				? categoryLookup.get(row.categoryName.toLowerCase())
				: undefined;

			const resolvedExchangeRate =
				row.exchangeRate ?? (row.currency === "USD" ? 1 : undefined);
			const resolvedAmountInUSD =
				row.amountInUSD ??
				(resolvedExchangeRate ? row.amount / resolvedExchangeRate : undefined);

			return {
				id: generateId(),
				title: row.title,
				amount: row.amount,
				currency: row.currency,
				exchangeRate: resolvedExchangeRate ?? null,
				amountInUSD: resolvedAmountInUSD ?? null,
				date: row.date,
				location: row.location ?? null,
				description: row.description ?? null,
				categoryId: matchedCategory?.id ?? null,
				category: matchedCategory
					? {
							id: matchedCategory.id,
							name: matchedCategory.name,
							color: matchedCategory.color,
						}
					: null,
				pricingSource: row.pricingSource ?? "IMPORT",
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
			const result = parseCsv(text);

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
			setParseError(error instanceof Error ? error.message : "Failed to read CSV file.");
			setPreviewData([]);
		} finally {
			// Allow re-uploading the same file
			if (fileInputRef.current) {
				fileInputRef.current.value = "";
			}
		}
	};

	const handleImport = async () => {
		if (previewData.length === 0) return;
		try {
			const rows = previewData.map((expense) => ({
				title: expense.title ?? "Untitled",
				amount: expense.amount,
				currency: expense.currency,
				date: expense.date,
				exchangeRate: expense.exchangeRate ?? undefined,
				amountInUSD:
					expense.amountInUSD ??
					(expense.currency === "USD" && expense.exchangeRate
						? expense.amount
						: undefined),
				location: expense.location,
				description: expense.description,
				categoryId: expense.categoryId ?? undefined,
				pricingSource: expense.pricingSource ?? "IMPORT",
			}));

			await importMutation.mutateAsync({ rows });
			toast.success(
				`Imported ${rows.length} expense${rows.length === 1 ? "" : "s"}`,
			);
			setPreviewData([]);
		} catch (error: unknown) {
			toast.error(error instanceof Error ? error.message : "Failed to import expenses");
		}
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>CSV Import & Export</CardTitle>
				<CardDescription>
					Export your finalized expenses or preview a CSV before importing to
					ensure everything maps correctly.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div className="space-y-1">
						<p className="font-medium">Export expenses</p>
						<p className="text-muted-foreground text-sm">
							Downloads all finalized expenses, including categories and pricing
							details.
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
							<p className="font-medium">Import expenses</p>
							<p className="text-muted-foreground text-sm">
								We will parse your CSV, match categories by name, and show the
								exact rows using the table view before importing.
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
					<div className="space-y-2 rounded-lg border p-4">
						<Label className="font-medium text-sm">CSV format</Label>
						<p className="text-muted-foreground text-sm">
							Required columns: title, amount, currency, date. Optional:
							exchangeRate, amountInUSD, category, location, description,
							pricingSource. Dates should use YYYY-MM-DD. Currency and category
							names are matched exactly.
						</p>
					</div>
					{parseError && (
						<div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-destructive text-sm">
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
								<div>
									<p className="font-medium">
										Preview ({previewData.length} row
										{previewData.length === 1 ? "" : "s"})
									</p>
									<p className="text-muted-foreground text-sm">
										This uses the same table view to ensure data will import
										correctly.
									</p>
								</div>
								<Button
									disabled={importMutation.isPending}
									onClick={() => setPreviewData([])}
									size="sm"
									variant="ghost"
								>
									Clear preview
								</Button>
							</div>
							<DataTable
								data={previewData}
								emptyState={
									<div className="text-muted-foreground">
										No rows to import.
									</div>
								}
								homeCurrency={settings?.homeCurrency ?? "USD"}
							/>
						</div>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
