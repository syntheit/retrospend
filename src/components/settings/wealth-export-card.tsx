"use client";

import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { api } from "~/trpc/react";

export function WealthExportCard() {
	const exportWealthMutation = api.wealth.exportCsv.useMutation();

	const handleExportWealth = async () => {
		try {
			const { csv } = await exportWealthMutation.mutateAsync();
			const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
			const url = URL.createObjectURL(blob);
			const link = document.createElement("a");
			link.href = url;
			link.download = `wealth-${new Date().toISOString().slice(0, 10)}.csv`;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);
			toast.success("Wealth data exported");
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Failed to export wealth data",
			);
		}
	};

	return (
		<Card>
			<CardContent className="space-y-6 pt-6">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div className="space-y-1">
						<p className="font-medium">Export wealth data</p>
						<p className="text-muted-foreground text-sm">
							Downloads all your asset accounts, including balances, types, and
							exchange rates.
						</p>
					</div>
					<Button
						className="w-full sm:w-auto"
						disabled={exportWealthMutation.isPending}
						onClick={handleExportWealth}
						variant="outline"
					>
						{exportWealthMutation.isPending ? "Preparing..." : "Download CSV"}
						<Download className="ml-2 h-4 w-4" />
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
