"use client";

import { formatDistanceToNow } from "date-fns";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { formatBytes, formatUptime } from "~/lib/format";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

export function SystemStatusCard({ className }: { className?: string }) {
	const { data: workerStatus } =
		api.system.getWorkerStatus.useQuery(undefined, {
			refetchInterval: 30000,
		});

	const { data: serverStats } =
		api.admin.getServerStats.useQuery(undefined, {
			refetchInterval: 30000,
		});

	const { data: sidecarStatus } =
		api.system.checkSidecarStatus.useQuery(undefined, {
			refetchInterval: 30000,
		});

	const { data: importQueueStats } =
		api.importQueue.getGlobalStats.useQuery(undefined, {
			refetchInterval: 30000,
		});

	const hasNoData =
		!workerStatus && !serverStats && !sidecarStatus && !importQueueStats;

	if (hasNoData) {
		return (
			<Card className={cn("flex flex-col", className)}>
				<CardHeader className="pb-2">
					<CardTitle className="font-medium text-muted-foreground text-sm">
						System Status
					</CardTitle>
				</CardHeader>
				<CardContent className="flex flex-grow items-center">
					<div className="h-4 w-24 animate-pulse rounded bg-muted" />
				</CardContent>
			</Card>
		);
	}

	const lastRun = workerStatus?.lastRun ? new Date(workerStatus.lastRun) : null;

	return (
		<Card className={cn("flex flex-col", className)}>
			<CardHeader>
				<CardTitle>System Status</CardTitle>
				<CardDescription>
					Monitor server health and resource usage.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex-grow">
				<div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4">
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-sm">Sidecar Status</span>
						<div className="flex items-center gap-2">
							<div
								className={`h-2 w-2 rounded-full ${sidecarStatus?.online ? "bg-emerald-500" : "bg-red-500"}`}
							/>
							<span className="font-medium text-sm">
								{sidecarStatus?.online ? "Online" : "Offline"}
							</span>
						</div>
					</div>
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-sm">
							Last Heartbeat
						</span>
						<span className="font-medium text-sm tabular-nums">
							{lastRun ? (
								<>{formatDistanceToNow(lastRun)} ago</>
							) : (
								"No activity detected"
							)}
						</span>
					</div>
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-sm">Sidecar Uptime</span>
						<span className="font-medium text-sm tabular-nums">
							{sidecarStatus?.online
								? formatUptime(sidecarStatus.uptime ?? 0)
								: "N/A"}
						</span>
					</div>
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-sm">AI Import</span>
						<div className="flex items-center gap-2">
							<div
								className={`h-2 w-2 rounded-full ${sidecarStatus?.importerAvailable ? "bg-emerald-500" : "bg-amber-400"}`}
							/>
							<span className="font-medium text-sm">
								{sidecarStatus?.importerAvailable ? "Enabled" : "Not configured"}
							</span>
						</div>
					</div>

					<div className="my-1 border-border/50 border-t" />

					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-sm">
							Import Queue Limit
						</span>
						<span className="font-medium text-sm tabular-nums">
							{importQueueStats?.currentProcessing ?? 0} /{" "}
							{importQueueStats?.maxConcurrent ?? 3} processing
						</span>
					</div>
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-sm">Queued Jobs</span>
						<span className="font-medium text-sm tabular-nums">
							{importQueueStats?.totalQueued ?? 0} waiting
							{(importQueueStats?.totalReadyForReview ?? 0) > 0 &&
								`, ${importQueueStats?.totalReadyForReview} ready`}
						</span>
					</div>

					<div className="my-1 border-border/50 border-t" />

					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-sm">Database Size</span>
						<span className="font-medium text-sm tabular-nums">
							{formatBytes(serverStats?.databaseSize ?? 0)}
						</span>
					</div>
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-sm">Media Storage</span>
						<span className="font-medium text-sm tabular-nums">
							{formatBytes(serverStats?.storageSize ?? 0)}
						</span>
					</div>
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-sm">App Uptime</span>
						<span className="font-medium text-sm tabular-nums">
							{formatUptime(serverStats?.uptime ?? 0)}
						</span>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
