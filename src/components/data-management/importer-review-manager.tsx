"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { format } from "date-fns";
import {
	AlertTriangle,
	Check,
	Copy,
	Eye,
	EyeOff,
	Trash2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { DataTable } from "~/components/data-table";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "~/components/ui/tooltip";
import { parseDateOnly } from "~/lib/date";
import { generateId } from "~/lib/id";
import { api } from "~/trpc/react";
import { EditableCell } from "./editable-cell";

/** Shape returned by the Go importer */
export interface ImporterTransaction {
	title: string;
	amount: number;
	currency: string;
	exchangeRate: number;
	amountInUSD: number;
	date: string; // YYYY-MM-DD
	location: string;
	description: string;
	pricingSource: string;
	category: string;
}

/**
 * Creates a unique fingerprint for duplicate detection.
 * Uses: date + title + amount + currency
 */
function createTransactionFingerprint(
	date: Date | string,
	title: string,
	amount: number,
	currency: string,
): string {
	const dateStr =
		typeof date === "string" ? date : date.toISOString().split("T")[0];
	return `${dateStr}|${title.trim()}|${Math.abs(amount)}|${currency.toUpperCase()}`;
}

/** Client-side enriched transaction for review */
export interface ImportTransaction {
	id: string;
	title: string;
	amount: number;
	currency: string;
	exchangeRate: number | null;
	amountInUSD: number | null;
	date: Date;
	location: string | null;
	description: string | null;
	category: string | null;
	categoryId: string | null;
	pricingSource: string;
	isDuplicate?: boolean;
}

interface ImporterReviewManagerProps {
	importerData: ImporterTransaction[];
	onDone: () => void;
	onCancel: () => void;
	warnings?: string[];
}

export function ImporterReviewManager({
	importerData,
	onDone,
	onCancel,
	warnings,
}: ImporterReviewManagerProps) {
	const { data: categories } = api.categories.getAll.useQuery();
	const { data: settings } = api.settings.getGeneral.useQuery();
	const importMutation = api.expense.importExpenses.useMutation();

	const homeCurrency = settings?.homeCurrency ?? "USD";

	// Calculate date range for duplicate detection
	const queryDateRange = useMemo(() => {
		if (!importerData.length) return null;
		const dates = importerData.map((tx) => parseDateOnly(tx.date).getTime());
		return {
			from: new Date(Math.min(...dates)),
			to: new Date(Math.max(...dates)),
		};
	}, [importerData]);

	// Fetch existing expenses in the date range for duplicate detection
	const { data: existingExpenses } = api.expense.listFinalized.useQuery(
		queryDateRange ?? { from: new Date(), to: new Date() },
		{ enabled: !!queryDateRange },
	);

	// Build fingerprint set from existing expenses
	const existingFingerprints = useMemo(() => {
		if (!existingExpenses) return new Set<string>();
		return new Set(
			existingExpenses.map((e) =>
				createTransactionFingerprint(
					e.date,
					e.title,
					Number(e.amount),
					e.currency,
				),
			),
		);
	}, [existingExpenses]);

	const [showDuplicates, setShowDuplicates] = useState(false);

	const categoryLookup = useMemo(() => {
		const map = new Map<string, NonNullable<typeof categories>[number]>();
		(categories ?? []).forEach((cat) => {
			map.set(cat.name.toLowerCase(), cat);
		});
		return map;
	}, [categories]);

	// Build initial transactions from importer data
	const [transactions, setTransactions] = useState<ImportTransaction[]>([]);

	// Initialize transactions when data is ready
	useEffect(() => {
		if (importerData.length === 0 || !existingFingerprints) return;

		const initialTransactions = importerData.map((tx) => {
			const matchedCat = tx.category
				? categoryLookup.get(tx.category.toLowerCase())
				: undefined;

			const date = parseDateOnly(tx.date);
			const amount = Math.abs(tx.amount);
			const currency = tx.currency || "USD";
			const title = tx.title || "Untitled";

			// Check if this transaction is a duplicate
			const fingerprint = createTransactionFingerprint(
				date,
				title,
				amount,
				currency,
			);
			const isDuplicate = existingFingerprints.has(fingerprint);

			return {
				id: generateId(),
				title,
				amount,
				currency,
				exchangeRate: tx.exchangeRate || null,
				amountInUSD: tx.amountInUSD || null,
				date,
				location: tx.location || null,
				description: tx.description || null,
				category: tx.category || null,
				categoryId: matchedCat?.id ?? null,
				pricingSource: tx.pricingSource || "IMPORTED",
				isDuplicate,
			};
		});

		setTransactions(initialTransactions);

		// Auto-select only non-duplicates
		const nonDuplicateIds = initialTransactions
			.filter((t) => !t.isDuplicate)
			.map((t) => t.id);
		setSelectedIds(new Set(nonDuplicateIds));
	}, [importerData, existingFingerprints, categoryLookup]);

	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

	const updateTransaction = useCallback(
		(id: string, field: keyof ImportTransaction, value: unknown) => {
			setTransactions((prev) =>
				prev.map((tx) => {
					if (tx.id !== id) return tx;
					const updated = { ...tx, [field]: value } as ImportTransaction;

					// When categoryId changes, sync the category name
					if (field === "categoryId") {
						if (value === "__none__" || !value) {
							updated.categoryId = null;
							updated.category = null;
						} else {
							const cat = (categories ?? []).find((c) => c.id === value);
							updated.category = cat?.name ?? null;
						}
					}

					// Maintain consistency for foreign currency amounts
					if (
						field === "amount" &&
						updated.exchangeRate &&
						updated.currency !== homeCurrency
					) {
						updated.amountInUSD = Number(value) / updated.exchangeRate;
					}

					return updated;
				}),
			);
		},
		[categories, homeCurrency],
	);

	const handleRowSelect = useCallback((id: string, checked: boolean) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (checked) next.add(id);
			else next.delete(id);
			return next;
		});
	}, []);

	const handleSelectAll = useCallback(
		(checked: boolean) => {
			setSelectedIds(
				checked ? new Set(transactions.map((t) => t.id)) : new Set(),
			);
		},
		[transactions],
	);

	// Filter transactions based on showDuplicates toggle
	const visibleTransactions = useMemo(
		() =>
			showDuplicates
				? transactions
				: transactions.filter((t) => !t.isDuplicate),
		[transactions, showDuplicates],
	);

	// Count duplicates
	const duplicateCount = useMemo(
		() => transactions.filter((t) => t.isDuplicate).length,
		[transactions],
	);

	// Summary stats
	const selectedTransactions = useMemo(
		() => transactions.filter((t) => selectedIds.has(t.id)),
		[transactions, selectedIds],
	);

	const totalAmount = useMemo(
		() => selectedTransactions.reduce((sum, t) => sum + t.amount, 0),
		[selectedTransactions],
	);

	const dateRange = useMemo(() => {
		if (selectedTransactions.length === 0) return null;
		const dates = selectedTransactions.map((t) => t.date.getTime());
		const min = new Date(Math.min(...dates));
		const max = new Date(Math.max(...dates));
		if (
			min.getMonth() === max.getMonth() &&
			min.getFullYear() === max.getFullYear()
		) {
			return format(min, "MMM yyyy");
		}
		return `${format(min, "MMM yyyy")} - ${format(max, "MMM yyyy")}`;
	}, [selectedTransactions]);

	const handleImport = async () => {
		if (selectedTransactions.length === 0) {
			toast.error("No transactions selected");
			return;
		}

		try {
			const rows = selectedTransactions.map((tx) => ({
				title: tx.title || "Untitled",
				amount: tx.amount,
				currency: tx.currency,
				date: tx.date,
				exchangeRate: tx.exchangeRate ?? undefined,
				amountInUSD: tx.amountInUSD ?? undefined,
				location: tx.location,
				description: tx.description,
				categoryId: tx.categoryId ?? undefined,
				pricingSource: tx.pricingSource || "IMPORTED",
			}));

			const result = await importMutation.mutateAsync({ rows });

			// Show success message with duplicate info if any were skipped
			if (result.skippedDuplicates > 0) {
				toast.success(
					`Imported ${result.count} expense${result.count === 1 ? "" : "s"}. Skipped ${result.skippedDuplicates} duplicate${result.skippedDuplicates === 1 ? "" : "s"}.`,
				);
			} else {
				toast.success(
					`Imported ${result.count} expense${result.count === 1 ? "" : "s"}`,
				);
			}
			onDone();
		} catch (error: unknown) {
			toast.error(
				error instanceof Error ? error.message : "Failed to import expenses",
			);
		}
	};

	const columns = useMemo(
		(): ColumnDef<ImportTransaction>[] => [
			{
				id: "select",
				header: ({ table }) => {
					const allSelected = table
						.getRowModel()
						.rows.every((row) => selectedIds.has(row.original.id));
					const someSelected = table
						.getRowModel()
						.rows.some((row) => selectedIds.has(row.original.id));

					return (
						<Checkbox
							aria-label="Select all rows"
							checked={
								allSelected ? true : someSelected ? "indeterminate" : false
							}
							onCheckedChange={(checked) => handleSelectAll(checked === true)}
						/>
					);
				},
				cell: ({ row }) => (
					<Checkbox
						aria-label={`Select row ${row.original.title}`}
						checked={selectedIds.has(row.original.id)}
						onCheckedChange={(checked) =>
							handleRowSelect(row.original.id, checked === true)
						}
					/>
				),
				enableSorting: false,
				size: 40,
			},
			{
				accessorKey: "title",
				header: "Title",
				enableSorting: true,
				cell: ({ row }) => {
					const isDuplicate = row.original.isDuplicate;
					return (
						<div className="flex items-center gap-2">
							<EditableCell
								className={isDuplicate ? "text-muted-foreground" : ""}
								onSave={(val) =>
									updateTransaction(row.original.id, "title", val)
								}
								type="text"
								value={row.original.title}
							/>
							{isDuplicate && (
								<Tooltip>
									<TooltipTrigger asChild>
										<div className="flex shrink-0 items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-amber-600 text-[10px] dark:text-amber-500">
											<Copy className="h-3 w-3" />
											Duplicate
										</div>
									</TooltipTrigger>
									<TooltipContent>
										This transaction already exists in your expenses
									</TooltipContent>
								</Tooltip>
							)}
						</div>
					);
				},
			},
			{
				accessorKey: "amount",
				header: () => <div className="text-right">Amount</div>,
				enableSorting: true,
				cell: ({ row }) => {
					const isForeign = row.original.currency !== homeCurrency;
					const isDuplicate = row.original.isDuplicate;
					return (
						<div className="flex flex-col items-end gap-0.5 text-right">
							<EditableCell
								className={`justify-end font-medium ${isDuplicate ? "text-muted-foreground" : ""}`}
								formatDisplay={(v) =>
									v != null
										? `${row.original.currency} ${Number(v).toFixed(2)}`
										: ""
								}
								onSave={(val) =>
									updateTransaction(row.original.id, "amount", val)
								}
								type="number"
								value={row.original.amount}
							/>
							{isForeign && row.original.amountInUSD && (
								<span className="px-1 opacity-80 text-muted-foreground text-[10px]">
									≈ {homeCurrency} {row.original.amountInUSD.toFixed(2)}
								</span>
							)}
						</div>
					);
				},
			},
			{
				accessorKey: "currency",
				header: "Currency",
				enableSorting: true,
				size: 80,
				cell: ({ row }) => {
					const isDuplicate = row.original.isDuplicate;
					return (
						<EditableCell
							className={isDuplicate ? "text-muted-foreground" : ""}
							onSave={(val) =>
								updateTransaction(
									row.original.id,
									"currency",
									String(val).toUpperCase(),
								)
							}
							type="text"
							value={row.original.currency}
						/>
					);
				},
			},
			{
				accessorKey: "date",
				header: "Date",
				enableSorting: true,
				sortingFn: "datetime",
				cell: ({ row }) => {
					const isDuplicate = row.original.isDuplicate;
					return (
						<EditableCell
							className={isDuplicate ? "text-muted-foreground" : ""}
							onSave={(val) => updateTransaction(row.original.id, "date", val)}
							type="date"
							value={row.original.date}
						/>
					);
				},
			},
			{
				accessorKey: "category",
				header: "Category",
				enableSorting: true,
				cell: ({ row }) => {
					const cat = row.original.categoryId
						? (categories ?? []).find((c) => c.id === row.original.categoryId)
						: null;

					if (cat) {
						return (
							<EditableCell
								categories={categories ?? []}
								formatDisplay={() => cat.name}
								onSave={(val) =>
									updateTransaction(row.original.id, "categoryId", val)
								}
								type="category"
								value={row.original.categoryId}
							/>
						);
					}

					// Show importer's category name as hint if no match
					const importerCatName = row.original.category;
					return (
						<div className="flex items-center gap-2">
							<EditableCell
								categories={categories ?? []}
								className="text-amber-600 dark:text-amber-500"
								formatDisplay={() =>
									importerCatName ? `${importerCatName}` : ""
								}
								onSave={(val) =>
									updateTransaction(row.original.id, "categoryId", val)
								}
								placeholder="Assign category"
								type="category"
								value={row.original.categoryId}
							/>
							<Tooltip>
								<TooltipTrigger asChild>
									<AlertTriangle className="h-3.5 w-3.5 shrink-0 animate-pulse text-amber-500" />
								</TooltipTrigger>
								<TooltipContent>
									Category not matched to any existing category. Please select
									one.
								</TooltipContent>
							</Tooltip>
						</div>
					);
				},
				sortingFn: (rowA, rowB) => {
					const a = rowA.original.category ?? "";
					const b = rowB.original.category ?? "";
					return a.localeCompare(b);
				},
			},
			{
				accessorKey: "location",
				header: "Location",
				enableSorting: true,
				cell: ({ row }) => (
					<EditableCell
						onSave={(val) =>
							updateTransaction(row.original.id, "location", val || null)
						}
						placeholder="—"
						type="text"
						value={row.original.location}
					/>
				),
			},
			{
				accessorKey: "description",
				header: "Description",
				enableSorting: false,
				cell: ({ row }) => (
					<EditableCell
						onSave={(val) =>
							updateTransaction(row.original.id, "description", val || null)
						}
						placeholder="—"
						type="text"
						value={row.original.description}
					/>
				),
			},
			{
				id: "actions",
				cell: ({ row }) => (
					<Button
						className="h-8 w-8 text-muted-foreground hover:text-destructive"
						onClick={() => {
							setTransactions((prev) =>
								prev.filter((t) => t.id !== row.original.id),
							);
							setSelectedIds((prev) => {
								const next = new Set(prev);
								next.delete(row.original.id);
								return next;
							});
						}}
						size="icon"
						variant="ghost"
					>
						<Trash2 className="h-4 w-4" />
					</Button>
				),
				size: 40,
			},
		],
		[
			selectedIds,
			handleSelectAll,
			handleRowSelect,
			updateTransaction,
			categories,
			homeCurrency,
		],
	);

	return (
		<TooltipProvider>
			<div className="space-y-4">
				{/* Warnings */}
				{warnings && warnings.length > 0 && (
					<Alert variant="warning">
						<AlertTriangle className="h-4 w-4" />
						<AlertTitle>Import Warnings ({warnings.length})</AlertTitle>
						<AlertDescription>
							<ul className="mt-2 list-disc pl-4 space-y-1 text-sm">
								{warnings.map((warning, idx) => (
									<li key={idx}>{warning}</li>
								))}
							</ul>
						</AlertDescription>
					</Alert>
				)}

				{/* Summary Bar */}
				<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
					<div className="flex flex-wrap items-center gap-3">
						<span className="font-medium">
							{selectedIds.size} of {transactions.length} selected
						</span>
						<span className="text-muted-foreground">|</span>
						<span className="tabular-nums">
							${totalAmount.toFixed(2)} total
						</span>
						{dateRange && (
							<>
								<span className="text-muted-foreground">|</span>
								<span className="text-muted-foreground">{dateRange}</span>
							</>
						)}
					</div>
					{duplicateCount > 0 && (
						<Button
							onClick={() => setShowDuplicates(!showDuplicates)}
							size="sm"
							variant="ghost"
						>
							{showDuplicates ? (
								<>
									<EyeOff className="mr-1.5 h-4 w-4" />
									Hide {duplicateCount} duplicate
									{duplicateCount === 1 ? "" : "s"}
								</>
							) : (
								<>
									<Eye className="mr-1.5 h-4 w-4" />
									Show {duplicateCount} duplicate
									{duplicateCount === 1 ? "" : "s"}
								</>
							)}
						</Button>
					)}
				</div>

				{/* Review Table */}
				<DataTable
					columns={columns}
					data={visibleTransactions}
					emptyState={
						<div className="text-muted-foreground">
							No transactions to review.
						</div>
					}
					pageSize={25}
					searchPlaceholder="Search transactions..."
				/>

				{/* Action Bar */}
				<div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3">
					<p className="text-muted-foreground text-sm">
						{selectedIds.size} transaction
						{selectedIds.size === 1 ? "" : "s"} will be imported
					</p>
					<div className="flex gap-2">
						<Button
							disabled={importMutation.isPending}
							onClick={onCancel}
							size="sm"
							variant="ghost"
						>
							<X className="mr-1 h-4 w-4" />
							Cancel
						</Button>
						<Button
							disabled={selectedIds.size === 0 || importMutation.isPending}
							onClick={handleImport}
							size="sm"
						>
							<Check className="mr-1 h-4 w-4" />
							{importMutation.isPending
								? "Importing..."
								: `Import ${selectedIds.size} Selected`}
						</Button>
					</div>
				</div>
			</div>
		</TooltipProvider>
	);
}
