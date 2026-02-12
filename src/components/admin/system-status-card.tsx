"use client";

import { formatDistanceToNow } from "date-fns";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "~/components/ui/card";
import { api } from "~/trpc/react";

export function SystemStatusCard({ className }: { className?: string }) {
	const { data: status, isLoading } = api.system.getWorkerStatus.useQuery(
		undefined,
		{
			refetchInterval: 30000, // Refresh every 30 seconds
		},
	);

	if (isLoading) {
		return (
			<Card className={className}>
				<CardHeader className="pb-2">
					<CardTitle className="font-medium text-muted-foreground text-sm">
						System Status
					</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="h-4 w-24 animate-pulse rounded bg-muted" />
				</CardContent>
			</Card>
		);
	}

	const lastRun = status?.lastRun ? new Date(status.lastRun) : null;
	const isHealthy = lastRun && Date.now() - lastRun.getTime() < 20 * 60 * 1000; // < 20 mins

	return (
		<Card className={className}>
			<CardHeader>
				<CardTitle>Background Worker</CardTitle>
				<CardDescription>
					Monitor the background worker daemon health.
				</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-4">
				<div className="flex items-center justify-between">
					<span className="font-medium text-sm">Status</span>
					<div className="flex items-center gap-2">
						<div
							className={`h-2 w-2 rounded-full ${isHealthy ? "bg-green-500" : "bg-red-500"}`}
						/>
						<span className="font-medium text-sm">
							{isHealthy ? "Operational" : "Offline"}
						</span>
					</div>
				</div>
				<div className="flex items-center justify-between">
					<span className="font-medium text-sm">Last Heartbeat</span>
					<span className="text-muted-foreground text-sm tabular-nums">
						{lastRun ? (
							<>{formatDistanceToNow(lastRun)} ago</>
						) : (
							"No activity detected"
						)}
					</span>
				</div>
			</CardContent>
		</Card>
	);
}
