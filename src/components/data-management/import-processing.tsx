"use client";

import { FileSearch, Loader2 } from "lucide-react";
import { Progress } from "~/components/ui/progress";

interface ImportProcessingProps {
	fileName?: string;
	progress?: number;
	statusMessage?: string;
}

export function ImportProcessing({
	fileName,
	progress,
	statusMessage,
}: ImportProcessingProps) {
	return (
		<div className="flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-muted-foreground/25 bg-muted/30 py-12 px-6">
			<div className="relative">
				<FileSearch className="h-10 w-10 text-muted-foreground" />
				<Loader2 className="absolute -top-1 -right-1 h-5 w-5 animate-spin text-primary" />
			</div>
			<div className="text-center w-full max-w-sm space-y-2">
				<p className="font-medium">
					{statusMessage || "Processing your file..."}
				</p>
				{fileName && (
					<p className="text-muted-foreground text-sm">{fileName}</p>
				)}

				{(progress !== undefined || progress === 0) && (
					<div className="space-y-1.5 pt-2">
						<Progress value={progress * 100} />
						<p className="text-muted-foreground text-[10px] uppercase tracking-wider font-bold">
							{Math.round(progress * 100)}% Complete
						</p>
					</div>
				)}

				{!progress && (
					<p className="mt-2 text-muted-foreground text-xs">
						Analyzing bank statement format. This may take a moment for PDFs.
					</p>
				)}
			</div>
		</div>
	);
}
