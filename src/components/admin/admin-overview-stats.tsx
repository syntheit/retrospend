"use client";

import { formatDistanceToNow } from "date-fns";
import { Activity, Archive, Database, Layers, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { StatCard } from "~/components/ui/stat-card";
import { formatBytes, formatUptime } from "~/lib/format";
import { api } from "~/trpc/react";

export function AdminOverviewStats() {
	const t = useTranslations("admin");
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
						{lastRun ? `${formatDistanceToNow(lastRun)} ago` : t("noHeartbeat")}
					</span>
				}
				title={t("sidecar")}
				value={workerHealthy ? t("online") : t("offline")}
				variant={workerHealthy ? "emerald" : "rose"}
			/>

			<StatCard
				className={cardClass}
				icon={Upload}
				subValue={
					<span className="text-muted-foreground text-xs">
						{sidecarStatus?.online
							? formatUptime(sidecarStatus.uptime ?? 0)
							: t("notConfigured")}
					</span>
				}
				title={t("aiImport")}
				value={sidecarStatus?.importerAvailable ? t("enabled") : t("disabled")}
				variant={sidecarStatus?.importerAvailable ? "emerald" : "amber"}
			/>

			<StatCard
				className={cardClass}
				icon={Layers}
				subValue={
					<span className="text-muted-foreground text-xs">
						{t("waiting", { count: importQueueStats?.totalQueued ?? 0 })}
					</span>
				}
				title={t("importQueue")}
				value={`${importQueueStats?.currentProcessing ?? 0} / ${importQueueStats?.maxConcurrent ?? 3}`}
				variant="blue"
			/>

			<StatCard
				className={cardClass}
				icon={Database}
				subValue={
					<span className="text-muted-foreground text-xs">
						{formatBytes(serverStats?.storageSize ?? 0)} {t("media")}
					</span>
				}
				title={t("database")}
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
							: t("never")}
					</span>
				}
				title={t("backups")}
				value={
					backup?.running
						? t("running")
						: backupHealthy
							? t("healthy")
							: backup?.available
								? t("failed")
								: t("notAvailable")
				}
				variant={backupHealthy ? "emerald" : "rose"}
			/>
		</div>
	);
}
