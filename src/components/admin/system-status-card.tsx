"use client";

import { formatDistanceToNow } from "date-fns";
import { useTranslations } from "next-intl";
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
	const t = useTranslations("admin");
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
						{t("systemStatus")}
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
				<CardTitle>{t("systemStatus")}</CardTitle>
				<CardDescription>
					{t("systemStatusDescription")}
				</CardDescription>
			</CardHeader>
			<CardContent className="flex-grow">
				<div className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4">
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-sm">{t("sidecarStatus")}</span>
						<div className="flex items-center gap-2">
							<div
								className={`h-2 w-2 rounded-full ${sidecarStatus?.online ? "bg-emerald-500" : "bg-red-500"}`}
							/>
							<span className="font-medium text-sm">
								{sidecarStatus?.online ? t("online") : t("offline")}
							</span>
						</div>
					</div>
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-sm">
							{t("lastHeartbeat")}
						</span>
						<span className="font-medium text-sm tabular-nums">
							{lastRun ? (
								<>{formatDistanceToNow(lastRun)} ago</>
							) : (
								t("noActivityDetected")
							)}
						</span>
					</div>
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-sm">{t("sidecarUptime")}</span>
						<span className="font-medium text-sm tabular-nums">
							{sidecarStatus?.online
								? formatUptime(sidecarStatus.uptime ?? 0)
								: t("notAvailable")}
						</span>
					</div>
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-sm">{t("aiImport")}</span>
						<div className="flex items-center gap-2">
							<div
								className={`h-2 w-2 rounded-full ${sidecarStatus?.importerAvailable ? "bg-emerald-500" : "bg-amber-400"}`}
							/>
							<span className="font-medium text-sm">
								{sidecarStatus?.importerAvailable ? t("enabled") : t("notConfiguredLabel")}
							</span>
						</div>
					</div>

					<div className="my-1 border-border/50 border-t" />

					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-sm">
							{t("importQueueLimit")}
						</span>
						<span className="font-medium text-sm tabular-nums">
							{t("processingCount", {
								current: importQueueStats?.currentProcessing ?? 0,
								max: importQueueStats?.maxConcurrent ?? 3,
							})}
						</span>
					</div>
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-sm">{t("queuedJobsLabel")}</span>
						<span className="font-medium text-sm tabular-nums">
							{t("waiting", { count: importQueueStats?.totalQueued ?? 0 })}
							{(importQueueStats?.totalReadyForReview ?? 0) > 0 &&
								`, ${t("readyCount", { count: importQueueStats?.totalReadyForReview ?? 0 })}`}
						</span>
					</div>

					<div className="my-1 border-border/50 border-t" />

					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-sm">{t("databaseSize")}</span>
						<span className="font-medium text-sm tabular-nums">
							{formatBytes(serverStats?.databaseSize ?? 0)}
						</span>
					</div>
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-sm">{t("mediaStorage")}</span>
						<span className="font-medium text-sm tabular-nums">
							{formatBytes(serverStats?.storageSize ?? 0)}
						</span>
					</div>
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-sm">{t("appUptime")}</span>
						<span className="font-medium text-sm tabular-nums">
							{formatUptime(serverStats?.uptime ?? 0)}
						</span>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
