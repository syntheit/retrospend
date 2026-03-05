"use client";

import {
	IconCircleCheck,
	IconCircleX,
	IconDatabase,
	IconDownload,
} from "@tabler/icons-react";
import { formatDistanceToNow } from "date-fns";
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
import { formatBytes } from "~/lib/format";
import { api } from "~/trpc/react";

interface BackupResult {
	timestamp: string;
	filename: string;
	sizeBytes: number;
	durationMs: number;
	success: boolean;
	error?: string;
}

interface BackupStatusData {
	available: boolean;
	running?: boolean;
	lastBackup?: BackupResult;
	nextScheduled?: string;
	retentionDays?: number;
	totalBackups?: number;
	totalSize?: number;
	history?: BackupResult[];
}

export function BackupStatusCard() {
	const [triggerResult, setTriggerResult] = useState<string | null>(null);

	const { data, isLoading } = api.admin.getBackupStatus.useQuery(undefined, {
		refetchInterval: 60000,
	});

	const utils = api.useUtils();
	const triggerMutation = api.admin.triggerBackup.useMutation({
		onSuccess: () => {
			setTriggerResult("Backup started");
			toast.success("Backup started successfully");
			// Refetch status after a short delay to show the running state
			setTimeout(() => {
				void utils.admin.getBackupStatus.invalidate();
			}, 2000);
		},
		onError: (error) => {
			setTriggerResult(null);
			toast.error(error.message);
		},
	});

	const status = data as BackupStatusData | undefined;

	if (isLoading) {
		return (
			<Card className="flex flex-col">
				<CardHeader className="pb-2">
					<CardTitle className="font-medium text-muted-foreground text-sm">
						Database Backups
					</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-grow items-center">
					<div className="h-4 w-24 animate-pulse rounded bg-muted" />
				</CardContent>
			</Card>
		);
	}

	if (!status?.available) {
		return (
			<Card className="flex flex-col">
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<IconDatabase className="h-5 w-5" />
						Database Backups
					</CardTitle>
					<CardDescription>
						Backup service is not available. Check worker connection.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex items-center gap-2">
						<div className="h-2.5 w-2.5 rounded-full bg-red-500" />
						<span className="font-medium text-sm">Unavailable</span>
					</div>
				</CardContent>
			</Card>
		);
	}

	const lastBackup = status.lastBackup;
	const lastBackupDate = lastBackup ? new Date(lastBackup.timestamp) : null;
	const isLastBackupOk = lastBackup?.success ?? false;
	const nextScheduled = status.nextScheduled
		? new Date(status.nextScheduled)
		: null;

	return (
		<Card className="flex h-full flex-col">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconDatabase className="h-5 w-5" />
					Database Backups
				</CardTitle>
				<CardDescription>
					Automatic backups with {status.retentionDays}-day retention.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-grow flex-col space-y-4">
				<div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4">
					{/* Status */}
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-sm">Backup Status</span>
						<div className="flex items-center gap-2">
							<div
								className={`h-2 w-2 rounded-full ${
									status.running
										? "animate-pulse bg-yellow-500"
										: isLastBackupOk
											? "bg-green-500"
											: "bg-red-500"
								}`}
							/>
							<span className="font-medium text-sm">
								{status.running
									? "Running"
									: isLastBackupOk
										? "Healthy"
										: lastBackup
											? "Failed"
											: "Never run"}
							</span>
						</div>
					</div>

					{/* Last backup */}
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-sm">Last Backup</span>
						<span className="font-medium text-sm tabular-nums">
							{lastBackupDate
								? formatDistanceToNow(lastBackupDate, {
										addSuffix: true,
									})
								: "Never"}
						</span>
					</div>

					{lastBackup?.success && (
						<div className="flex items-center justify-between">
							<span className="text-muted-foreground text-sm">Backup Size</span>
							<span className="font-medium text-sm tabular-nums">
								{formatBytes(lastBackup.sizeBytes)}
							</span>
						</div>
					)}

					<div className="my-1 border-border/50 border-t" />

					{/* Next scheduled */}
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-sm">
							Next Scheduled
						</span>
						<span className="font-medium text-sm tabular-nums">
							{nextScheduled
								? formatDistanceToNow(nextScheduled, {
										addSuffix: true,
									})
								: "N/A"}
						</span>
					</div>

					{/* Total */}
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-sm">Total Backups</span>
						<span className="font-medium text-sm tabular-nums">
							{status.totalBackups ?? 0} ({formatBytes(status.totalSize ?? 0)})
						</span>
					</div>
				</div>

				{/* History */}
				{status.history && status.history.length > 0 && (
					<div className="space-y-2">
						<span className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
							Recent History
						</span>
						<div className="space-y-1">
							{status.history.slice(0, 5).map((entry) => (
								<div
									className="flex items-center justify-between rounded px-2 py-1 text-xs"
									key={entry.filename || entry.timestamp}
								>
									<div className="flex items-center gap-2">
										{entry.success ? (
											<IconCircleCheck className="h-3.5 w-3.5 text-green-500" />
										) : (
											<IconCircleX className="h-3.5 w-3.5 text-red-500" />
										)}
										<span className="text-muted-foreground">
											{formatDistanceToNow(new Date(entry.timestamp), {
												addSuffix: true,
											})}
										</span>
									</div>
									<div className="flex items-center gap-3">
										{entry.success && (
											<span className="text-muted-foreground tabular-nums">
												{formatBytes(entry.sizeBytes)}
											</span>
										)}
										<span className="text-muted-foreground tabular-nums">
											{(entry.durationMs / 1000).toFixed(1)}s
										</span>
									</div>
								</div>
							))}
						</div>
					</div>
				)}

				<div className="flex-grow" />

				{/* Manual trigger */}
				<div className="flex items-center gap-3">
					<Button
						disabled={triggerMutation.isPending || status.running}
						onClick={() => {
							setTriggerResult(null);
							triggerMutation.mutate();
						}}
						size="sm"
						variant="outline"
					>
						{triggerMutation.isPending || status.running ? (
							<>
								<IconDownload className="mr-2 h-4 w-4 animate-spin" />
								Backing up...
							</>
						) : (
							<>
								<IconDownload className="mr-2 h-4 w-4" />
								Backup Now
							</>
						)}
					</Button>

					{triggerResult && (
						<span className="text-green-600 text-sm dark:text-green-400">
							{triggerResult}
						</span>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
