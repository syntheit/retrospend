"use client";

import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
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
	const t = useTranslations("dataManagement");

	return (
		<div className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
			<div className="space-y-1">
				<p className="font-medium">{t("exportTitle", { title: title.toLowerCase() })}</p>
				<p className="text-muted-foreground text-sm">{description}</p>
			</div>
			<Button
				className="w-full sm:w-auto"
				disabled={isExporting}
				onClick={onExport}
				variant="outline"
			>
				{isExporting ? t("preparing") : t("downloadCsv")}
				<Download className="ml-2 h-4 w-4" />
			</Button>
		</div>
	);
}
