"use client";

import { Download } from "lucide-react";
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
			toast.success("All user data exported");
		} catch (err: unknown) {
			toast.error(err instanceof Error ? err.message : "Failed to export data");
		} finally {
			setIsExporting(false);
		}
	};

	return (
		<div className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
			<div className="space-y-1">
				<p className="font-medium">Export all user data</p>
				<p className="text-muted-foreground text-sm">
					Download your data (expenses, wealth, etc.) as CSV files in a ZIP
					archive.
				</p>
			</div>
			<Button
				className="w-full sm:w-auto"
				disabled={isExporting || exportData.isPending}
				onClick={handleExport}
				variant="outline"
			>
				{isExporting || exportData.isPending ? "Preparing..." : "Download ZIP"}
				<Download className="ml-2 h-4 w-4" />
			</Button>
		</div>
	);
}

export function DataManagementCard() {
	return (
		<Card className="border-muted/50 shadow-lg">
			<CardHeader className="pb-3">
				<CardTitle className="font-bold text-2xl tracking-tight">
					Export Data
				</CardTitle>
				<CardDescription>
					Download your financial data as CSV files.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Tabs className="w-full" defaultValue="expenses">
					<TabsList className="mb-2 grid w-full grid-cols-4">
						<TabsTrigger className="text-xs sm:text-sm" value="expenses">
							Expenses
						</TabsTrigger>
						<TabsTrigger className="text-xs sm:text-sm" value="budgets">
							Budgets
						</TabsTrigger>
						<TabsTrigger className="text-xs sm:text-sm" value="wealth">
							Wealth
						</TabsTrigger>
						<TabsTrigger className="text-xs sm:text-sm" value="alldata">
							All Data
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
