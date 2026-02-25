"use client";

import { IconCircleCheck, IconClock, IconRefresh } from "@tabler/icons-react";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { Button } from "~/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { api } from "~/trpc/react";

export function RateSyncControl() {
	const [syncResult, setSyncResult] = useState<{
		success: boolean;
		message: string;
	} | null>(null);

	// tRPC hooks
	const utils = api.useUtils();
	const { data: lastSync, isLoading: lastSyncLoading } =
		api.exchangeRate.getLastSync.useQuery();

	const syncNowMutation = api.exchangeRate.syncNow.useMutation({
		onSuccess: () => {
			void utils.exchangeRate.getAllRates.invalidate();
			void utils.exchangeRate.getLastSync.invalidate();
		},
	});

	const handleSyncNow = async () => {
		setSyncResult(null);
		try {
			const result = await syncNowMutation.mutateAsync();
			setSyncResult(result);
		} catch (error) {
			setSyncResult({
				success: false,
				message: error instanceof Error ? error.message : "Sync failed",
			});
		}
	};

	const formatLastSync = (date: Date | null | undefined) => {
		if (!date) return "Never";
		return formatDistanceToNow(date, { addSuffix: true });
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconRefresh className="h-5 w-5" />
					Exchange Rate Sync
				</CardTitle>
				<CardDescription>
					Manage automatic synchronization of exchange rates. Rates are updated
					daily at 09:05 UTC.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{/* Last Sync Status */}
				<div className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
					<div className="flex items-center gap-2">
						<IconClock className="h-4 w-4 text-muted-foreground" />
						<span className="font-medium text-sm">Last Synced:</span>
					</div>
					<span className="text-muted-foreground text-sm">
						{lastSyncLoading ? "Loading..." : formatLastSync(lastSync)}
					</span>
				</div>

				{/* Manual Sync Button */}
				<div className="flex items-center gap-3">
					<Button
						disabled={syncNowMutation.isPending}
						onClick={handleSyncNow}
						size="sm"
						variant="outline"
					>
						{syncNowMutation.isPending ? (
							<>
								<IconRefresh className="mr-2 h-4 w-4 animate-spin" />
								Syncing...
							</>
						) : (
							<>
								<IconRefresh className="mr-2 h-4 w-4" />
								Sync Now
							</>
						)}
					</Button>

					{/* Sync Result */}
					{syncResult && (
						<div
							className={`flex items-center gap-2 text-sm ${
								syncResult.success
									? "text-green-600 dark:text-green-400"
									: "text-red-600 dark:text-red-400"
							}`}
						>
							{syncResult.success ? (
								<IconCircleCheck className="h-4 w-4" />
							) : (
								<IconRefresh className="h-4 w-4" />
							)}
							{syncResult.message}
						</div>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
