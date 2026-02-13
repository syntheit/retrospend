"use client";

import { Download, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { DataTable } from "~/components/data-table";
import { createExpenseColumns } from "~/components/data-table-columns";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Separator } from "~/components/ui/separator";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { type ParsedCsvRow, parseCsv } from "~/lib/csv";
import { generateId, type NormalizedExpense } from "~/lib/utils";
import { api } from "~/trpc/react";

export function ExpensesTab() {
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const [previewData, setPreviewData] = useState<NormalizedExpense[]>([]);
	const [parseError, setParseError] = useState<string | null>(null);
	const { formatCurrency } = useCurrencyFormatter();

	const { data: settings } = api.settings.getGeneral.useQuery();
	const { data: categories } = api.categories.getAll.useQuery();

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
			toast.error(
				error instanceof Error ? error.message : "Failed to export CSV",
			);
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
			const rows = previewData.map((expense) => ({
				title: expense.title ?? "Untitled",
				amount: expense.amount,
				currency: expense.currency,
				date: expense.date,
				exchangeRate: expense.exchangeRate ?? undefined,
				amountInUSD: expense.amountInUSD ?? undefined,
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
			toast.error(
				error instanceof Error ? error.message : "Failed to import expenses",
			);
		}
	};

	const homeCurrency = settings?.homeCurrency ?? "USD";
	const hasForeignCurrencyExpenses = previewData.some(
		(e) => e.currency !== "USD" && e.exchangeRate && e.amountInUSD,
	);

	const columns = useMemo(
		() =>
			createExpenseColumns(
				homeCurrency,
				null,
				hasForeignCurrencyExpenses,
				new Set(),
				() => {},
				() => {},
				formatCurrency,
			),
		[homeCurrency, hasForeignCurrencyExpenses, formatCurrency],
	);

	return (
		<div className="space-y-6 pt-4">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="space-y-1">
					<p className="font-medium">Export expenses</p>
					<p className="text-muted-foreground text-sm">
						Downloads all finalized expenses as a CSV file.
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
							Upload a CSV to preview and import your expenses.
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
				<div className="space-y-2 rounded-lg border p-4 bg-muted/30">
					<Label className="font-medium text-sm">CSV format</Label>
					<p className="text-muted-foreground text-sm leading-relaxed">
						Required columns: <code className="text-primary">title</code>,{" "}
						<code className="text-primary">amount</code>,{" "}
						<code className="text-primary">currency</code>,{" "}
						<code className="text-primary">date</code>. <br />
						Optional: <code className="text-muted-foreground">category</code>,{" "}
						<code className="text-muted-foreground">location</code>,{" "}
						<code className="text-muted-foreground">description</code>. Dates:{" "}
						<code className="text-primary">YYYY-MM-DD</code>.
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
							<div>
								<p className="font-medium">
									Preview ({previewData.length} row
									{previewData.length === 1 ? "" : "s"})
								</p>
								<p className="text-muted-foreground text-sm">
									Review entries before final import.
								</p>
							</div>
							<Button
								disabled={importMutation.isPending}
								onClick={() => setPreviewData([])}
								size="sm"
								variant="ghost"
							>
								Clear
							</Button>
						</div>
						<DataTable
							columns={columns}
							data={previewData}
							emptyState={
								<div className="text-muted-foreground">No rows to import.</div>
							}
						/>
					</div>
				)}
			</div>
		</div>
	);
}
