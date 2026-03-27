"use client";

import { FileSearch, Loader2 } from "lucide-react";
import { Progress } from "~/components/ui/progress";

interface ImporterProcessingProps {
	fileName?: string;
	progress?: number;
	statusMessage?: string;
}

export function ImporterProcessing({
	fileName,
	progress,
	statusMessage,
}: ImporterProcessingProps) {
	return (
		<div className="flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-muted-foreground/25 border-dashed bg-muted/30 px-6 py-12">
			<div className="relative">
				<FileSearch className="h-10 w-10 text-muted-foreground" />
				<Loader2 className="absolute -top-1 -right-1 h-5 w-5 animate-spin text-primary" />
			</div>
			<div aria-live="polite" className="w-full max-w-sm space-y-2 text-center">
				<p className="font-medium">
					{statusMessage || "Processing your file..."}
				</p>
				{fileName && (
					<p className="text-muted-foreground text-sm">{fileName}</p>
				)}

				{(progress !== undefined || progress === 0) && (
					<div className="space-y-1.5 pt-2">
						<Progress value={progress * 100} />
						<p className="font-bold text-[10px] text-muted-foreground tracking-wide">
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
