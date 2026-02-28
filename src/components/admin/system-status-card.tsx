"use client";

import { formatDistanceToNow } from "date-fns";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { cn } from "~/lib/utils";
import { api } from "~/trpc/react";

function formatBytes(bytes: number): string {
	if (bytes === 0) return "0 B";
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB", "TB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function formatUptime(seconds: number): string {
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);

	if (days > 0) {
		return `${days}d ${hours}h ${minutes}m`;
	}
	if (hours > 0) {
		return `${hours}h ${minutes}m`;
	}
	return `${minutes}m`;
}

export function SystemStatusCard({ className }: { className?: string }) {
	const { data: status, isLoading: statusLoading } =
		api.system.getWorkerStatus.useQuery(undefined, {
			refetchInterval: 30000, // Refresh every 30 seconds
		});

	const { data: serverStats, isLoading: statsLoading } =
		api.admin.getServerStats.useQuery(undefined, {
			refetchInterval: 30000, // Refresh every 30 seconds
		});

	const { data: importerStatus, isLoading: importerLoading } =
		api.system.checkImporterStatus.useQuery(undefined, {
			refetchInterval: 30000, // Refresh every 30 seconds
		});

	const isLoading = statusLoading || statsLoading || importerLoading;

	if (isLoading) {
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

	const lastRun = status?.lastRun ? new Date(status.lastRun) : null;
	const isHealthy = lastRun && Date.now() - lastRun.getTime() < 20 * 60 * 1000; // < 20 mins

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
						<span className="text-muted-foreground text-sm">Worker Status</span>
						<div className="flex items-center gap-2">
							<div
								className={`h-2 w-2 rounded-full ${isHealthy ? "bg-green-500" : "bg-red-500"}`}
							/>
							<span className="text-sm font-medium">
								{isHealthy ? "Operational" : "Offline"}
							</span>
						</div>
					</div>
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-sm">
							Last Heartbeat
						</span>
						<span className="tabular-nums text-sm font-medium">
							{lastRun ? (
								<>{formatDistanceToNow(lastRun)} ago</>
							) : (
								"No activity detected"
							)}
						</span>
					</div>

					<div className="my-1 border-t border-border/50" />

					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-sm">
							Importer Status
						</span>
						<div className="flex items-center gap-2">
							<div
								className={`h-2 w-2 rounded-full ${importerStatus?.available ? "bg-green-500" : "bg-red-500"}`}
							/>
							<span className="text-sm font-medium">
								{importerStatus?.available ? "Operational" : "Offline"}
							</span>
						</div>
					</div>
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-sm">
							Importer Uptime
						</span>
						<span className="tabular-nums text-sm font-medium">
							{importerStatus?.available
								? formatUptime(importerStatus.uptime ?? 0)
								: "N/A"}
						</span>
					</div>

					<div className="my-1 border-t border-border/50" />

					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-sm">Database Size</span>
						<span className="tabular-nums text-sm font-medium">
							{formatBytes(serverStats?.databaseSize ?? 0)}
						</span>
					</div>
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-sm">App Uptime</span>
						<span className="tabular-nums text-sm font-medium">
							{formatUptime(serverStats?.uptime ?? 0)}
						</span>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
