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

export function SystemStatusCard({ className }: { className?: string }) {
	const { data: status, isLoading } = api.system.getWorkerStatus.useQuery(
		undefined,
		{
			refetchInterval: 30000, // Refresh every 30 seconds
		},
	);

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
				<CardTitle>Background Worker</CardTitle>
				<CardDescription>
					Monitor the background worker daemon health.
				</CardDescription>
			</CardHeader>
			<CardContent className="flex-grow">
				<div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4">
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-sm">Status</span>
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
				</div>
			</CardContent>
		</Card>
	);
}
