"use client";

import { Download } from "lucide-react";
import { Button } from "~/components/ui/button";

interface DataExportProps {
	title: string;
	description: string;
	onExport: () => Promise<void>;
	isExporting: boolean;
}

export function DataExport({
	title,
	description,
	onExport,
	isExporting,
}: DataExportProps) {
	return (
		<div className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
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
	);
}
