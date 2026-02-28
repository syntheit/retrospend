"use client";

import { Download, FileText, Info, Upload, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Separator } from "~/components/ui/separator";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";

interface DataImporterExportProps<T> {
	title: string;
	description: string;
	onExport: () => Promise<void>;
	isExporting: boolean;
	onImport: (data: T[]) => Promise<void>;
	isImporting: boolean;
	sampleData?: string;
	sampleFilename?: string;
	formatInfo: React.ReactNode;
	parseCsv: (text: string) => { rows: T[]; errors: string[] };
	validateRow?: (row: T) => boolean;
	renderPreview: React.ComponentType<{ data: T[] }>;
}

export function DataImporterExport<T>({
	title,
	description,
	onExport,
	isExporting,
	onImport,
	isImporting,
	sampleData,
	sampleFilename = "sample.csv",
	formatInfo,
	parseCsv,
	validateRow,
	renderPreview: Preview,
}: DataImporterExportProps<T>) {
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const [previewData, setPreviewData] = useState<T[]>([]);
	const [parseError, setParseError] = useState<string | null>(null);
	const [isDragging, setIsDragging] = useState(false);
	const [fileName, setFileName] = useState<string | null>(null);

	const processFile = useCallback(
		async (file: File) => {
			if (!file) return;

			setFileName(file.name);
			try {
				const text = await file.text();
				const result = parseCsv(text);

				if (result.errors.length > 0) {
					setParseError(
						result.errors.slice(0, 5).join("\n") +
							(result.errors.length > 5
								? `\n...and ${result.errors.length - 5} more errors`
								: ""),
					);
					setPreviewData([]);
					return;
				}

				let rows = result.rows;
				if (validateRow) {
					rows = rows.filter(validateRow);
				}

				setParseError(null);
				setPreviewData(rows);
				toast.success(
					`Loaded ${rows.length} row${rows.length === 1 ? "" : "s"} for import`,
				);
			} catch (error: unknown) {
				setParseError(
					error instanceof Error ? error.message : "Failed to read CSV file.",
				);
				setPreviewData([]);
			}
		},
		[parseCsv, validateRow],
	);

	const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		if (file) {
			processFile(file);
		}
		// Reset input so same file can be selected again if needed
		event.target.value = "";
	};

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
			if ((file && file.type === "text/csv") || file?.name.endsWith(".csv")) {
				processFile(file);
			} else {
				toast.error("Please drop a CSV file");
			}
		},
		[processFile],
	);

	const handleImportClick = async () => {
		if (previewData.length === 0) return;
		try {
			await onImport(previewData);
			setPreviewData([]);
			setFileName(null);
		} catch {
			// Error handling usually in parent
		}
	};

	const handleClear = () => {
		setPreviewData([]);
		setFileName(null);
		setParseError(null);
	};

	const downloadSample = () => {
		if (!sampleData) return;
		const blob = new Blob([sampleData], { type: "text/csv;charset=utf-8;" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = sampleFilename;
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	};

	return (
		<div className="space-y-6 pt-4">
			{/* Export Section */}
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="space-y-1">
					<p className="font-medium">Export {title.toLowerCase()}</p>
					<p className="text-muted-foreground text-sm">{description}</p>
				</div>
				<Button
					className="w-full sm:w-auto"
					disabled={isExporting}
					onClick={onExport}
					variant="outline"
				>
					{isExporting ? "Preparing..." : "Download CSV"}
					<Download className="ml-2 h-4 w-4" />
				</Button>
			</div>

			<Separator />

			{/* Import Section */}
			<div className="space-y-4">
				<div className="flex items-center justify-between">
					<div className="space-y-1">
						<div className="flex items-center gap-2">
							<p className="font-medium">Import {title.toLowerCase()}</p>
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
											<div className="text-xs opacity-90">{formatInfo}</div>
											{sampleData && (
												<Button
													className="h-auto p-0 text-primary hover:text-primary/80 text-xs underline"
													onClick={downloadSample}
													variant="link"
												>
													Download sample CSV
												</Button>
											)}
										</div>
									</TooltipContent>
								</Tooltip>
							</TooltipProvider>
						</div>
						<p className="text-muted-foreground text-sm">
							Drag and drop your CSV file here.
						</p>
					</div>
					{sampleData && (
						<Button
							className="h-8 text-xs"
							onClick={downloadSample}
							size="sm"
							variant="outline"
						>
							<FileText className="mr-2 h-3.5 w-3.5" />
							Sample CSV
						</Button>
					)}
				</div>

				<button
					className={cn(
						"flex h-32 w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
						isDragging
							? "border-primary bg-primary/5"
							: "border-border/50 hover:border-border hover:bg-secondary/20",
						parseError ? "border-destructive/50 bg-destructive/5" : "",
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
						<p className="font-medium text-sm">
							{fileName ? fileName : "Drop CSV or Click to Browse"}
						</p>
						{fileName && (
							<p className="mt-1 text-muted-foreground text-xs">
								Click to replace
							</p>
						)}
					</div>
				</button>

				{parseError && (
					<div className="relative rounded-md border border-destructive/50 bg-destructive/10 p-3 font-mono text-destructive text-sm">
						<div className="whitespace-pre-wrap">{parseError}</div>
						<Button
							className="absolute top-2 right-2 h-6 w-6 hover:bg-destructive/20"
							onClick={() => setParseError(null)}
							size="icon"
							variant="ghost"
						>
							<X className="h-4 w-4" />
						</Button>
					</div>
				)}

				<Input
					accept=".csv,text/csv"
					className="hidden"
					onChange={handleFileChange}
					ref={fileInputRef}
					type="file"
				/>

				{/* Preview Section */}
				{previewData.length > 0 && (
					<div className="fade-in slide-in-from-top-2 animate-in space-y-3 pt-2">
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
							<div className="flex gap-2">
								<Button
									disabled={isImporting}
									onClick={handleClear}
									size="sm"
									variant="ghost"
								>
									Cancel
								</Button>
								<Button
									disabled={isImporting}
									onClick={handleImportClick}
									size="sm"
								>
									{isImporting ? "Importing..." : "Confirm Import"}
								</Button>
							</div>
						</div>
						<div className="max-h-[400px] overflow-auto rounded-md border">
							<Preview data={previewData} />
						</div>
					</div>
				)}
			</div>
		</div>
	);
}
