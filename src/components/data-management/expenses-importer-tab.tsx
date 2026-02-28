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
import { useCurrency } from "~/hooks/use-currency";
import { useNavigationGuard } from "~/hooks/use-navigation-guard";
import { parseRawCsv } from "~/lib/csv";
import { ExpenseImportSchema } from "~/lib/schemas/data-importer";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";
import { Separator } from "../ui/separator";
import { ImportJobReviewModal } from "./import-job-review-modal";
import { ImportQueuePanel } from "./import-queue-panel";
import { ImporterProcessing } from "./importer-processing";
import {
	ImporterReviewManager,
	type ImporterTransaction,
} from "./importer-review-manager";

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
	| { step: "review"; data: ImporterTransaction[]; warnings?: string[] }
	| { step: "error"; message: string };

export function ExpensesImporterTab({
	isActive = true,
}: {
	isActive?: boolean;
}) {
	const { homeCurrency } = useCurrency();
	const [mode, setMode] = useState<ImportMode>("bank");
	const [csvState, setCsvState] = useState<CsvState>({ step: "upload" });
	const [bankState, setBankState] = useState<BankState>({ step: "upload" });
	const [reviewJobId, setReviewJobId] = useState<string | null>(null);

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
		<div className="space-y-6 pt-4">
			{/* Import Queue Panel */}
			<ImportQueuePanel onReviewJob={setReviewJobId} />

			{/* Import Job Review Modal */}
			<ImportJobReviewModal
				jobId={reviewJobId}
				onClose={() => setReviewJobId(null)}
			/>

			<Separator />

			{/* Start New Import Section */}
			<div className="space-y-4">
				<h3 className="font-semibold text-lg">Start New Import</h3>

				<ToggleGroup
					className="w-full"
					onValueChange={handleModeChange}
					type="single"
					value={mode}
					variant="outline"
				>
					<ToggleGroupItem className="flex-1 gap-2" value="bank">
						<Landmark className="h-4 w-4" />
						Bank Statement
					</ToggleGroupItem>
					<ToggleGroupItem className="flex-1 gap-2" value="csv">
						<FileSpreadsheet className="h-4 w-4" />
						Retrospend CSV/Excel
					</ToggleGroupItem>
				</ToggleGroup>

				{mode === "csv" ? (
					<RetrospendCsvImport
						mainCurrency={homeCurrency}
						setState={setCsvState}
						state={csvState}
					/>
				) : (
					<BankStatementImport
						mainCurrency={homeCurrency}
						setState={setBankState}
						state={bankState}
					/>
				)}
			</div>

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
	mainCurrency,
}: {
	state: CsvState;
	setState: React.Dispatch<React.SetStateAction<CsvState>>;
	mainCurrency: string;
}) {
	const { data: categories } = api.categories.getAll.useQuery();
	const fileInputRef = useRef<HTMLInputElement | null>(null);

	const createJobMutation = api.importQueue.createJob.useMutation({
		onSuccess: () => {
			toast.success("Import job queued");
			if (fileInputRef.current) {
				fileInputRef.current.value = "";
			}
		},
		onError: (error) => {
			toast.error(`Failed to queue import: ${error.message}`);
		},
	});

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

					const resolvedCurrency = row.currency || mainCurrency;
					const resolvedExchangeRate =
						row.exchangeRate ?? (resolvedCurrency === "USD" ? 1 : 1);
					const resolvedAmountInUSD =
						row.amountInUSD ??
						(resolvedExchangeRate
							? row.amount / resolvedExchangeRate
							: row.amount);

					return {
						title: row.title,
						amount: row.amount,
						currency: resolvedCurrency,
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
		[categoryLookup, normalizeKeys, mainCurrency],
	);

	const handleFileChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			if (!file) return;

			const name = file.name.toLowerCase();
			const isXlsx = name.endsWith(".xlsx");

			const reader = new FileReader();
			reader.onload = async (evt) => {
				let base64: string;

				if (isXlsx) {
					// For XLSX, read as ArrayBuffer and convert to base64
					const arrayBuffer = evt.target?.result as ArrayBuffer;
					const uint8Array = new Uint8Array(arrayBuffer);
					let binary = "";
					for (let i = 0; i < uint8Array.byteLength; i++) {
						binary += String.fromCharCode(uint8Array[i]!);
					}
					base64 = btoa(binary);
				} else {
					// For CSV, read as text and convert to base64
					const text = evt.target?.result as string;
					base64 = btoa(text);
				}

				await createJobMutation.mutateAsync({
					fileName: file.name,
					fileSize: file.size,
					fileType: "csv",
					type: "CSV",
					fileData: base64,
				});
			};

			if (isXlsx) {
				reader.readAsArrayBuffer(file);
			} else {
				reader.readAsText(file);
			}
		},
		[createJobMutation],
	);

	const resetState = useCallback(() => {
		setState({ step: "upload" });
	}, [setState]);

	if (state.step === "review") {
		return (
			<div className="pt-4">
				<ImporterReviewManager
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
						<p className="font-medium">Import Retrospend CSV/Excel</p>
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
						Upload a CSV or Excel file exported from Retrospend or in the correct format.
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
								<li key={`${i}-${err}`} className="font-mono text-xs">
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
					<p className="font-medium text-sm">Click to Browse CSV or Excel File</p>
					<p className="mt-1 text-muted-foreground text-xs">
						Retrospend expense format (.csv or .xlsx)
					</p>
				</div>
			</button>

			<Input
				accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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
	mainCurrency,
}: {
	state: BankState;
	setState: React.Dispatch<React.SetStateAction<BankState>>;
	mainCurrency: string;
}) {
	const { data: importerStatus, isLoading: statusLoading } =
		api.system.checkImporterStatus.useQuery();

	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const [isDragging, setIsDragging] = useState(false);

	const createJobMutation = api.importQueue.createJob.useMutation({
		onSuccess: () => {
			toast.success("Import job queued");
			if (fileInputRef.current) {
				fileInputRef.current.value = "";
			}
		},
		onError: (error) => {
			toast.error(`Failed to queue import: ${error.message}`);
		},
	});

	const handleFile = useCallback(
		async (file: File) => {
			const name = file.name.toLowerCase();
			if (!name.endsWith(".csv") && !name.endsWith(".pdf") && !name.endsWith(".xlsx")) {
				toast.error("Please upload a CSV, Excel, or PDF file");
				return;
			}

			// Convert file to base64
			const reader = new FileReader();
			reader.onload = async (evt) => {
				const arrayBuffer = evt.target?.result as ArrayBuffer;
				const uint8Array = new Uint8Array(arrayBuffer);
				let binary = "";
				for (let i = 0; i < uint8Array.byteLength; i++) {
					binary += String.fromCharCode(uint8Array[i]!);
				}
				const base64 = btoa(binary);

				// Determine file type
				let fileType: "csv" | "xlsx" | "pdf";
				if (name.endsWith(".pdf")) {
					fileType = "pdf";
				} else if (name.endsWith(".xlsx")) {
					fileType = "xlsx";
				} else {
					fileType = "csv";
				}

				// Create job with file data (queue will auto-process)
				await createJobMutation.mutateAsync({
					fileName: file.name,
					fileSize: file.size,
					fileType,
					type: "BANK_STATEMENT",
					fileData: base64,
				});
			};
			reader.readAsArrayBuffer(file);
		},
		[createJobMutation],
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
				<ImporterReviewManager
					importerData={state.data}
					onCancel={resetState}
					onDone={resetState}
					warnings={state.warnings}
				/>
			</div>
		);
	}

	if (state.step === "processing") {
		return (
			<div className="pt-4">
				<ImporterProcessing
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
					Upload a CSV, Excel, or PDF bank statement. Supports Chase, Capital One, Bank
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
					<p className="font-medium text-sm">Drop CSV/Excel/PDF or Click to Browse</p>
					<p className="mt-1 text-muted-foreground text-xs">
						Bank statements are processed securely
					</p>
				</div>
			</button>

			<Input
				accept=".csv,.xlsx,.pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf"
				className="hidden"
				onChange={handleFileChange}
				ref={fileInputRef}
				type="file"
			/>
		</div>
	);
}
