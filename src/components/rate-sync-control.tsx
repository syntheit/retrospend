"use client";

import { CheckCircle, Clock, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { useTranslations } from "next-intl";
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
	const t = useTranslations("currencies");
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
		if (!date) return t("never");
		return formatDistanceToNow(date, { addSuffix: true });
	};

	return (
		<Card className="flex h-full flex-col">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<RefreshCw className="h-5 w-5" />
					{t("exchangeRateSync")}
				</CardTitle>
				<CardDescription>
					{t("exchangeRateSyncDescription")}
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-grow flex-col space-y-4">
				{/* Last Sync Status */}
				<div className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
					<div className="flex items-center gap-2">
						<Clock className="h-4 w-4 text-muted-foreground" />
						<span className="font-medium text-sm">{t("lastSynced")}</span>
					</div>
					<span className="text-muted-foreground text-sm">
						{lastSyncLoading ? t("loadingRates") : formatLastSync(lastSync)}
					</span>
				</div>

				<div className="flex-grow" />

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
								<RefreshCw className="mr-2 h-4 w-4 animate-spin" />
								{t("syncing")}
							</>
						) : (
							<>
								<RefreshCw className="mr-2 h-4 w-4" />
								{t("syncNow")}
							</>
						)}
					</Button>

					{/* Sync Result */}
					{syncResult && (
						<div
							className={`flex items-center gap-2 text-sm ${
								syncResult.success
									? "text-emerald-600 dark:text-emerald-400"
									: "text-red-600 dark:text-red-400"
							}`}
						>
							{syncResult.success ? (
								<CheckCircle className="h-4 w-4" />
							) : (
								<RefreshCw className="h-4 w-4" />
							)}
							{syncResult.message}
						</div>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
