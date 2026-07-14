"use client";

import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { api } from "~/trpc/react";
import { BudgetsExportTab } from "./budgets-export-tab";
import { ExpensesExportTab } from "./expenses-export-tab";
import { WealthExportTab } from "./wealth-export-tab";

function AllDataTab() {
	const t = useTranslations("dataManagement");
	const exportData = api.exportData.allData.useMutation();
	const [isExporting, setIsExporting] = useState(false);

	const handleExport = async () => {
		try {
			setIsExporting(true);
			const { zipData, filename } = await exportData.mutateAsync();
			const binaryString = atob(zipData);
			const bytes = new Uint8Array(binaryString.length);
			for (let i = 0; i < binaryString.length; i++) {
				bytes[i] = binaryString.charCodeAt(i);
			}
			const blob = new Blob([bytes], { type: "application/zip" });
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = filename;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);
			toast.success(t("allUserDataExported"));
		} catch (err: unknown) {
			toast.error(err instanceof Error ? err.message : t("failedToExportData"));
		} finally {
			setIsExporting(false);
		}
	};

	return (
		<div className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
			<div className="space-y-1">
				<p className="font-medium">{t("exportAllUserData")}</p>
				<p className="text-muted-foreground text-sm">
					{t("exportAllUserDataDescription")}
				</p>
			</div>
			<Button
				className="w-full sm:w-auto"
				disabled={isExporting || exportData.isPending}
				onClick={handleExport}
				variant="outline"
			>
				{isExporting || exportData.isPending ? t("preparing") : t("downloadZip")}
				<Download className="ml-2 h-4 w-4" />
			</Button>
		</div>
	);
}

export function DataManagementCard() {
	const t = useTranslations("dataManagement");

	return (
		<Card className="border-border/50 shadow-sm">
			<CardHeader>
				<CardTitle>{t("exportDataTitle")}</CardTitle>
				<CardDescription>
					{t("exportDataDescription")}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Tabs className="w-full" defaultValue="expenses">
					<TabsList className="mb-2 grid w-full grid-cols-4">
						<TabsTrigger className="text-xs sm:text-sm" value="expenses">
							{t("expenses")}
						</TabsTrigger>
						<TabsTrigger className="text-xs sm:text-sm" value="budgets">
							{t("budgets")}
						</TabsTrigger>
						<TabsTrigger className="text-xs sm:text-sm" value="wealth">
							{t("wealth")}
						</TabsTrigger>
						<TabsTrigger className="text-xs sm:text-sm" value="alldata">
							{t("allData")}
						</TabsTrigger>
					</TabsList>
					<TabsContent value="expenses">
						<ExpensesExportTab />
					</TabsContent>
					<TabsContent value="budgets">
						<BudgetsExportTab />
					</TabsContent>
					<TabsContent value="wealth">
						<WealthExportTab />
					</TabsContent>
					<TabsContent value="alldata">
						<AllDataTab />
					</TabsContent>
				</Tabs>
			</CardContent>
		</Card>
	);
}
