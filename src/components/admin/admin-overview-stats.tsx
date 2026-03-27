"use client";

import { formatDistanceToNow } from "date-fns";
import { Activity, Archive, Database, Layers, Upload } from "lucide-react";
import { StatCard } from "~/components/ui/stat-card";
import { formatBytes, formatUptime } from "~/lib/format";
import { api } from "~/trpc/react";

export function AdminOverviewStats() {
	const { data: workerStatus } = api.system.getWorkerStatus.useQuery(
		undefined,
		{ refetchInterval: 30000 },
	);

	const { data: serverStats } = api.admin.getServerStats.useQuery(undefined, {
		refetchInterval: 30000,
	});

	const { data: sidecarStatus } = api.system.checkSidecarStatus.useQuery(
		undefined,
		{ refetchInterval: 30000 },
	);

	const { data: importQueueStats } = api.importQueue.getGlobalStats.useQuery(
		undefined,
		{
			refetchInterval: 30000,
		},
	);

	const { data: backupStatus } = api.admin.getBackupStatus.useQuery(undefined, {
		refetchInterval: 60000,
	});

	const backup = backupStatus as
		| {
				available: boolean;
				running?: boolean;
				lastBackup?: {
					timestamp: string;
					success: boolean;
				};
		  }
		| undefined;

	// Worker health
	const lastRun = workerStatus?.lastRun ? new Date(workerStatus.lastRun) : null;
	const workerHealthy =
		lastRun && Date.now() - lastRun.getTime() < 20 * 60 * 1000;

	// Backup health
	const lastBackupOk = backup?.lastBackup?.success ?? false;
	const lastBackupDate = backup?.lastBackup
		? new Date(backup.lastBackup.timestamp)
		: null;
	const backupHealthy = backup?.available && (lastBackupOk || backup?.running);

	const cardClass = "h-[8.5rem]";

	return (
		<div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
			<StatCard
				className={cardClass}
				icon={Activity}
				subValue={
					<span className="text-muted-foreground text-xs">
						{lastRun ? `${formatDistanceToNow(lastRun)} ago` : "No heartbeat"}
					</span>
				}
				title="Sidecar"
				value={workerHealthy ? "Online" : "Offline"}
				variant={workerHealthy ? "emerald" : "rose"}
			/>

			<StatCard
				className={cardClass}
				icon={Upload}
				subValue={
					<span className="text-muted-foreground text-xs">
						{sidecarStatus?.online
							? formatUptime(sidecarStatus.uptime ?? 0)
							: "Not configured"}
					</span>
				}
				title="AI Import"
				value={sidecarStatus?.importerAvailable ? "Enabled" : "Disabled"}
				variant={sidecarStatus?.importerAvailable ? "emerald" : "amber"}
			/>

			<StatCard
				className={cardClass}
				icon={Layers}
				subValue={
					<span className="text-muted-foreground text-xs">
						{importQueueStats?.totalQueued ?? 0} waiting
					</span>
				}
				title="Import Queue"
				value={`${importQueueStats?.currentProcessing ?? 0} / ${importQueueStats?.maxConcurrent ?? 3}`}
				variant="blue"
			/>

			<StatCard
				className={cardClass}
				icon={Database}
				subValue={
					<span className="text-muted-foreground text-xs">
						{formatBytes(serverStats?.storageSize ?? 0)} media
					</span>
				}
				title="Database"
				value={formatBytes(serverStats?.databaseSize ?? 0)}
				variant="violet"
			/>

			<StatCard
				className={cardClass}
				icon={Archive}
				subValue={
					<span className="text-muted-foreground text-xs">
						{lastBackupDate
							? `${formatDistanceToNow(lastBackupDate)} ago`
							: "Never"}
					</span>
				}
				title="Backups"
				value={
					backup?.running
						? "Running"
						: backupHealthy
							? "Healthy"
							: backup?.available
								? "Failed"
								: "N/A"
				}
				variant={backupHealthy ? "emerald" : "rose"}
			/>
		</div>
	);
}
