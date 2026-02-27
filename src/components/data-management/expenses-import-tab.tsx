"use client";

import { useMemo } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { DataTable } from "~/components/data-table";
import { createExpenseColumns } from "~/components/data-table-columns";
import { useCurrencyFormatter } from "~/hooks/use-currency-formatter";
import { parseRawCsv } from "~/lib/csv";
import { ExpenseImportSchema } from "~/lib/schemas/data-import";
import { generateId, type NormalizedExpense } from "~/lib/utils";
import { api } from "~/trpc/react";
import { DataImport } from "./data-import";

export function ExpensesImportTab() {
	const { formatCurrency } = useCurrencyFormatter();

	const { data: settings } = api.settings.getGeneral.useQuery();
	const { data: categories } = api.categories.getAll.useQuery();

	const importMutation = api.expense.importExpenses.useMutation();

	const categoryLookup = useMemo(() => {
		const map = new Map<string, NonNullable<typeof categories>[number]>();
		(categories ?? []).forEach((category) => {
			map.set(category.name.toLowerCase(), category);
		});
		return map;
	}, [categories]);

	const normalizeKeys = (row: Record<string, string>) => {
		const newRow: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(row)) {
			const k = key.toLowerCase().replace(/\s+/g, "");
			if (k === "amountinusd") newRow.amountInUSD = value;
			else if (k === "exchangerate") newRow.exchangeRate = value;
			else if (k === "category") newRow.category = value;
			else if (k === "pricingsource") newRow.pricingSource = value;
			else if (k === "location") newRow.location = value;
			else if (k === "description") newRow.description = value;
			else if (k === "title") newRow.title = value;
			else if (k === "amount") newRow.amount = value;
			else if (k === "currency") newRow.currency = value;
			else if (k === "date") newRow.date = value;
			else newRow[key] = value;
		}
		return newRow;
	};

	const handleParseCsv = (
		text: string,
	): { rows: NormalizedExpense[]; errors: string[] } => {
		const { data: rawData, errors: rawErrors } = parseRawCsv(text);
		if (rawErrors.length > 0) return { rows: [], errors: rawErrors };

		const normalizedData = rawData.map(normalizeKeys);
		const parseResult = z.array(ExpenseImportSchema).safeParse(normalizedData);

		if (!parseResult.success) {
			const formattedErrors: string[] = parseResult.error.errors.map((err) => {
				const rowIdx = (err.path[0] as number) + 1;
				const field = err.path[1];
				return `Row ${rowIdx}: ${field} - ${err.message}`;
			});
			return {
				rows: [],
				errors: Array.from(new Set(formattedErrors)).slice(0, 10),
			};
		}

		const enrichedRows: NormalizedExpense[] = parseResult.data.map((row) => {
			const matchedCategory = row.category
				? categoryLookup.get(row.category.toLowerCase())
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

		return { rows: enrichedRows, errors: [] };
	};

	const handleImport = async (previewData: NormalizedExpense[]) => {
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
		} catch (error: unknown) {
			toast.error(
				error instanceof Error ? error.message : "Failed to import expenses",
			);
			throw error;
		}
	};

	const homeCurrency = settings?.homeCurrency ?? "USD";

	const Preview = useMemo(() => {
		const ExpensePreview = ({ data }: { data: NormalizedExpense[] }) => {
			const hasForeignCurrencyExpenses = data.some(
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
				[hasForeignCurrencyExpenses],
			);

			return (
				<DataTable
					columns={columns}
					data={data}
					emptyState={
						<div className="text-muted-foreground">No rows to import.</div>
					}
				/>
			);
		};
		ExpensePreview.displayName = "ExpensePreview";
		return ExpensePreview;
	}, [homeCurrency, formatCurrency]);

	return (
		<DataImport
			formatInfo={
				<p>
					Required columns: <code className="text-primary">title</code>,{" "}
					<code className="text-primary">amount</code>,{" "}
					<code className="text-primary">currency</code>,{" "}
					<code className="text-primary">date</code>. <br />
					Optional: <code className="text-muted-foreground">category</code>,{" "}
					<code className="text-muted-foreground">location</code>,{" "}
					<code className="text-muted-foreground">description</code>. Dates:{" "}
					<code className="text-primary">YYYY-MM-DD</code>.
				</p>
			}
			isImporting={importMutation.isPending}
			onImport={handleImport}
			parseCsv={handleParseCsv}
			renderPreview={Preview}
			sampleData={[
				"title,amount,currency,date,category,location,description",
				"Groceries,50.25,USD,2024-01-01,Food,Market,Weekly shopping",
				"Transport,15.00,EUR,2024-01-02,Travel,Subway,Commute",
			].join("\n")}
			sampleFilename="expenses_sample.csv"
			title="Expenses"
		/>
	);
}
