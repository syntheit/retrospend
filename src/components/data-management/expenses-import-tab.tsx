"use client";

import {
	AlertCircle,
	FileSpreadsheet,
	Info,
	Landmark,
	Upload,
	X,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "~/components/ui/tooltip";
import { UnsavedChangesDialog } from "~/components/ui/unsaved-changes-dialog";
import { useNavigationGuard } from "~/hooks/use-navigation-guard";
import { parseRawCsv } from "~/lib/csv";
import { ExpenseImportSchema } from "~/lib/schemas/data-import";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import { ImportProcessing } from "./import-processing";
import {
	type ImporterTransaction,
	ImportReviewManager,
} from "./import-review-manager";

type ImportMode = "csv" | "bank";

// ── Retrospend CSV Mode Types ────────────────────────────────────────

type CsvState =
	| { step: "upload" }
	| { step: "review"; data: ImporterTransaction[] }
	| { step: "error"; errors: string[] };

// ── Bank Statement Mode Types ────────────────────────────────────────

type BankState =
	| { step: "upload" }
	| {
			step: "processing";
			fileName: string;
			progress?: number;
			statusMessage?: string;
	  }
	| { step: "review"; data: ImporterTransaction[] }
	| { step: "error"; message: string };

export function ExpensesImportTab({ isActive = true }: { isActive?: boolean }) {
	const [mode, setMode] = useState<ImportMode>("csv");
	const [csvState, setCsvState] = useState<CsvState>({ step: "upload" });
	const [bankState, setBankState] = useState<BankState>({ step: "upload" });

	const isDirty =
		csvState.step === "review" ||
		bankState.step === "review" ||
		bankState.step === "processing";

	const {
		showDialog,
		setShowDialog,
		handleDiscard,
		handleStay,
		pendingNavigation,
		setPendingNavigation,
	} = useNavigationGuard({
		enabled: isDirty && isActive,
		onDiscard: () => {
			setCsvState({ step: "upload" });
			setBankState({ step: "upload" });
		},
	});

	const handleModeChange = (val: string) => {
		if (!val) return;
		const nextMode = val as ImportMode;
		if (nextMode === mode) return;

		if (isDirty) {
			setPendingNavigation(`mode:${nextMode}`);
			setShowDialog(true);
		} else {
			setMode(nextMode);
		}
	};

	return (
		<div className="space-y-4 pt-4">
			<ToggleGroup
				className="w-full"
				onValueChange={handleModeChange}
				type="single"
				value={mode}
				variant="outline"
			>
				<ToggleGroupItem className="flex-1 gap-2" value="csv">
					<FileSpreadsheet className="h-4 w-4" />
					Retrospend CSV
				</ToggleGroupItem>
				<ToggleGroupItem className="flex-1 gap-2" value="bank">
					<Landmark className="h-4 w-4" />
					Bank Statement
				</ToggleGroupItem>
			</ToggleGroup>

			{mode === "csv" ? (
				<RetrospendCsvImport setState={setCsvState} state={csvState} />
			) : (
				<BankStatementImport setState={setBankState} state={bankState} />
			)}

			<UnsavedChangesDialog
				onDiscard={() => {
					const navigation = pendingNavigation;
					handleDiscard();
					if (navigation?.startsWith("mode:")) {
						const nextMode = navigation.split(":")[1] as ImportMode;
						setMode(nextMode);
					}
				}}
				onOpenChange={setShowDialog}
				onStay={handleStay}
				open={showDialog}
			/>
		</div>
	);
}

// ── Retrospend CSV Mode ──────────────────────────────────────────────

function RetrospendCsvImport({
	state,
	setState,
}: {
	state: CsvState;
	setState: React.Dispatch<React.SetStateAction<CsvState>>;
}) {
	const { data: categories } = api.categories.getAll.useQuery();
	const fileInputRef = useRef<HTMLInputElement | null>(null);

	const categoryLookup = useMemo(() => {
		const map = new Map<string, NonNullable<typeof categories>[number]>();
		(categories ?? []).forEach((category) => {
			map.set(category.name.toLowerCase(), category);
		});
		return map;
	}, [categories]);

	const normalizeKeys = useCallback((row: Record<string, string>) => {
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
	}, []);

	const handleParseCsv = useCallback(
		(text: string): { data: ImporterTransaction[]; errors: string[] } => {
			const { data: rawData, errors: rawErrors } = parseRawCsv(text);
			if (rawErrors.length > 0) return { data: [], errors: rawErrors };

			const normalizedData = rawData.map(normalizeKeys);
			const parseResult = z
				.array(ExpenseImportSchema)
				.safeParse(normalizedData);

			if (!parseResult.success) {
				const formattedErrors: string[] = parseResult.error.errors.map(
					(err) => {
						const rowIdx = (err.path[0] as number) + 1;
						const field = err.path[1];
						return `Row ${rowIdx}: ${field} - ${err.message}`;
					},
				);
				return {
					data: [],
					errors: Array.from(new Set(formattedErrors)).slice(0, 10),
				};
			}

			const transactions: ImporterTransaction[] = parseResult.data.map(
				(row) => {
					const matchedCategory = row.category
						? categoryLookup.get(row.category.toLowerCase())
						: undefined;

					const resolvedExchangeRate =
						row.exchangeRate ?? (row.currency === "USD" ? 1 : 1);
					const resolvedAmountInUSD =
						row.amountInUSD ??
						(resolvedExchangeRate
							? row.amount / resolvedExchangeRate
							: row.amount);

					return {
						title: row.title,
						amount: row.amount,
						currency: row.currency,
						exchangeRate: resolvedExchangeRate,
						amountInUSD: resolvedAmountInUSD,
						date: row.date.toISOString().split("T")[0] ?? "",
						location: row.location ?? "",
						description: row.description ?? "",
						pricingSource: row.pricingSource ?? "IMPORT",
						category: matchedCategory?.name ?? row.category ?? "",
					};
				},
			);

			return { data: transactions, errors: [] };
		},
		[categoryLookup, normalizeKeys],
	);

	const handleFileChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			if (!file) return;

			const reader = new FileReader();
			reader.onload = (evt) => {
				const text = evt.target?.result as string;
				const { data, errors } = handleParseCsv(text);

				if (errors.length > 0) {
					setState({ step: "error", errors });
					toast.error("Failed to parse CSV file");
					return;
				}

				if (data.length === 0) {
					setState({
						step: "error",
						errors: ["No valid transactions found in the file"],
					});
					toast.error("No transactions found");
					return;
				}

				setState({ step: "review", data });
				toast.success(
					`Loaded ${data.length} transaction${data.length === 1 ? "" : "s"}`,
				);
			};
			reader.readAsText(file);
			e.target.value = "";
		},
		[handleParseCsv, setState],
	);

	const resetState = useCallback(() => {
		setState({ step: "upload" });
	}, [setState]);

	if (state.step === "review") {
		return (
			<div className="pt-4">
				<ImportReviewManager
					importerData={state.data}
					onCancel={resetState}
					onDone={resetState}
				/>
			</div>
		);
	}

	return (
		<div className="space-y-4 pt-4">
			<div className="flex items-center justify-between">
				<div className="space-y-1">
					<div className="flex items-center gap-2">
						<p className="font-medium">Import Retrospend CSV</p>
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button
										className="h-6 w-6 rounded-full"
										size="icon"
										variant="ghost"
									>
										<Info className="h-4 w-4 text-muted-foreground" />
									</Button>
								</TooltipTrigger>
								<TooltipContent className="max-w-xs">
									<div className="space-y-2">
										<p className="font-semibold text-xs">
											CSV Format Requirements
										</p>
										<div className="text-xs opacity-90">
											<p>
												Required: <code className="text-primary">title</code>,{" "}
												<code className="text-primary">amount</code>,{" "}
												<code className="text-primary">currency</code>,{" "}
												<code className="text-primary">date</code>.
												<br />
												Optional:{" "}
												<code className="text-muted-foreground">category</code>,{" "}
												<code className="text-muted-foreground">location</code>,{" "}
												<code className="text-muted-foreground">
													description
												</code>
												,{" "}
												<code className="text-muted-foreground">
													exchangeRate
												</code>
												,{" "}
												<code className="text-muted-foreground">
													amountInUSD
												</code>
												.
												<br />
												Date format:{" "}
												<code className="text-primary">YYYY-MM-DD</code>
											</p>
										</div>
									</div>
								</TooltipContent>
							</Tooltip>
						</TooltipProvider>
					</div>
					<p className="text-muted-foreground text-sm">
						Upload a CSV exported from Retrospend or in the correct format.
					</p>
				</div>
			</div>

			{state.step === "error" && (
				<Alert variant="destructive">
					<AlertCircle className="h-4 w-4" />
					<AlertTitle>CSV Parse Errors</AlertTitle>
					<AlertDescription>
						<ul className="mt-2 list-disc space-y-1 pl-4">
							{state.errors.map((err, i) => (
								<li key={i} className="font-mono text-xs">
									{err}
								</li>
							))}
						</ul>
					</AlertDescription>
				</Alert>
			)}

			<button
				className="flex h-32 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-muted-foreground/25 bg-muted/30 transition-colors hover:border-muted-foreground/50 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
				onClick={() => fileInputRef.current?.click()}
				type="button"
			>
				<Upload className="h-8 w-8 text-muted-foreground" />
				<div className="text-center">
					<p className="font-medium text-sm">Click to Browse CSV File</p>
					<p className="mt-1 text-muted-foreground text-xs">
						Retrospend expense format
					</p>
				</div>
			</button>

			<Input
				accept=".csv,text/csv"
				className="hidden"
				onChange={handleFileChange}
				ref={fileInputRef}
				type="file"
			/>
		</div>
	);
}

// ── Bank Statement Mode ──────────────────────────────────────────────

function BankStatementImport({
	state,
	setState,
}: {
	state: BankState;
	setState: React.Dispatch<React.SetStateAction<BankState>>;
}) {
	const { data: importerStatus, isLoading: statusLoading } =
		api.system.checkImporterStatus.useQuery();

	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const [isDragging, setIsDragging] = useState(false);

	const handleFile = useCallback(
		async (file: File) => {
			const name = file.name.toLowerCase();
			if (!name.endsWith(".csv") && !name.endsWith(".pdf")) {
				toast.error("Please upload a CSV or PDF file");
				return;
			}

			setState({
				step: "processing",
				fileName: file.name,
				progress: 0,
				statusMessage: "Uploading file...",
			});

			const formData = new FormData();
			formData.append("file", file);

			try {
				const response = await fetch("/api/import/process", {
					method: "POST",
					body: formData,
				});

				if (!response.ok) {
					const body = (await response.json().catch(() => ({}))) as {
						error?: string;
					};
					throw new Error(body.error ?? `Import failed (${response.status})`);
				}

				if (!response.body) {
					throw new Error("No response body");
				}

				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let transactions: ImporterTransaction[] = [];
				let buffer = "";

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split("\n");
					buffer = lines.pop() || "";

					for (const line of lines) {
						if (!line.trim()) continue;
						try {
							const msg = JSON.parse(line) as {
								type: string;
								percent?: number;
								message?: string;
								data?: ImporterTransaction[];
							};

							if (msg.type === "progress") {
								setState((prev) =>
									prev.step === "processing"
										? {
												...prev,
												progress: msg.percent,
												statusMessage: msg.message,
											}
										: prev,
								);
							} else if (msg.type === "result") {
								transactions = msg.data ?? [];
							} else if (msg.type === "error") {
								throw new Error(msg.message || "Failed to process file");
							}
						} catch (e) {
							console.error("Failed to parse progress message:", e);
						}
					}
				}

				if (transactions.length === 0) {
					throw new Error(
						"No transactions found in the file. Please check the format.",
					);
				}

				setState({ step: "review", data: transactions });
				toast.success(
					`Found ${transactions.length} transaction${
						transactions.length === 1 ? "" : "s"
					}`,
				);
			} catch (error: unknown) {
				const message =
					error instanceof Error ? error.message : "Failed to process file";
				setState({ step: "error", message });
				toast.error(message);
			}
		},
		[setState],
	);

	const handleFileChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			if (file) handleFile(file);
			e.target.value = "";
		},
		[handleFile],
	);

	const handleDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragging(true);
	}, []);

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragging(false);
	}, []);

	const handleDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			setIsDragging(false);

			const file = e.dataTransfer.files?.[0];
			if (file) handleFile(file);
		},
		[handleFile],
	);

	const resetState = useCallback(() => {
		setState({ step: "upload" });
	}, [setState]);

	if (!statusLoading && !importerStatus?.available) {
		return (
			<div className="pt-4">
				<Alert variant="warning">
					<AlertCircle className="h-4 w-4" />
					<AlertTitle>Bank statement import unavailable</AlertTitle>
					<AlertDescription>
						The bank statement import service is not configured on this
						instance. Use the Retrospend CSV format to import your data, or
						contact your administrator.
					</AlertDescription>
				</Alert>
			</div>
		);
	}

	if (state.step === "review") {
		return (
			<div className="pt-4">
				<ImportReviewManager
					importerData={state.data}
					onCancel={resetState}
					onDone={resetState}
				/>
			</div>
		);
	}

	if (state.step === "processing") {
		return (
			<div className="pt-4">
				<ImportProcessing
					fileName={state.fileName}
					progress={state.progress}
					statusMessage={state.statusMessage}
				/>
			</div>
		);
	}

	return (
		<div className="space-y-4 pt-4">
			<div className="space-y-1">
				<p className="font-medium">Import bank statement</p>
				<p className="text-muted-foreground text-sm">
					Upload a CSV or PDF bank statement. Supports Chase, Capital One, Bank
					of America, Fidelity, and more.
				</p>
			</div>

			{state.step === "error" && (
				<div className="relative rounded-md border border-destructive/50 bg-destructive/10 p-3 font-mono text-destructive text-sm">
					<div className="whitespace-pre-wrap">{state.message}</div>
					<Button
						className="absolute top-2 right-2 h-6 w-6 hover:bg-destructive/20"
						onClick={resetState}
						size="icon"
						variant="ghost"
					>
						<X className="h-4 w-4" />
					</Button>
				</div>
			)}

			<button
				className={cn(
					"flex h-32 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
					isDragging
						? "border-primary bg-primary/5"
						: "border-muted-foreground/25 bg-muted/30 hover:border-muted-foreground/50 hover:bg-muted/50",
				)}
				onClick={() => fileInputRef.current?.click()}
				onDragLeave={handleDragLeave}
				onDragOver={handleDragOver}
				onDrop={handleDrop}
				type="button"
			>
				<Upload
					className={cn(
						"h-8 w-8 text-muted-foreground transition-all",
						isDragging && "scale-110 text-primary",
					)}
				/>
				<div className="text-center">
					<p className="font-medium text-sm">Drop CSV/PDF or Click to Browse</p>
					<p className="mt-1 text-muted-foreground text-xs">
						Bank statements are processed securely
					</p>
				</div>
			</button>

			<Input
				accept=".csv,.pdf,text/csv,application/pdf"
				className="hidden"
				onChange={handleFileChange}
				ref={fileInputRef}
				type="file"
			/>
		</div>
	);
}
