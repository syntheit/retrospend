"use client";

import { formatDistanceToNow } from "date-fns";
import { useTranslations } from "next-intl";
import { Section } from "~/components/layout/section";
import { SettingRow, SettingRows } from "~/features/settings/setting-row";
import { formatUptime } from "~/lib/format";
import { api } from "~/trpc/react";

const WORKER_FRESH_MS = 20 * 60 * 1000;

function Value({ children }: { children: React.ReactNode }) {
	return <span className="text-fg text-body tabular-nums">{children}</span>;
}

/**
 * How the server is doing, one row each: the sidecar, AI import, the import
 * queue and backups (the database size is a figure at the top of the page). The word is the status, never a color.
 */
export function AdminOverviewStats() {
	const t = useTranslations("admin");
	const { data: workerStatus } = api.system.getWorkerStatus.useQuery(
		undefined,
		{ refetchInterval: 30000 },
	);
	const { data: sidecarStatus } = api.system.checkSidecarStatus.useQuery(
		undefined,
		{ refetchInterval: 30000 },
	);
	const { data: importQueueStats } = api.importQueue.getGlobalStats.useQuery(
		undefined,
		{ refetchInterval: 30000 },
	);
	const { data: backupStatus } = api.admin.getBackupStatus.useQuery(undefined, {
		refetchInterval: 60000,
	});

	const backup = backupStatus as
		| {
				available: boolean;
				running?: boolean;
				lastBackup?: { timestamp: string; success: boolean };
		  }
		| undefined;

	const lastRun = workerStatus?.lastRun ? new Date(workerStatus.lastRun) : null;
	const workerHealthy =
		lastRun !== null && Date.now() - lastRun.getTime() < WORKER_FRESH_MS;
	const lastBackupDate = backup?.lastBackup
		? new Date(backup.lastBackup.timestamp)
		: null;
	const backupHealthy =
		backup?.available &&
		((backup.lastBackup?.success ?? false) || backup.running);

	const backupWord = backup?.running
		? t("running")
		: backupHealthy
			? t("healthy")
			: backup?.available
				? t("failed")
				: t("notAvailable");

	return (
		<Section title={t("health")}>
			<SettingRows>
				<SettingRow
					label={t("sidecar")}
					meta={
						lastRun
							? t("ago", { time: formatDistanceToNow(lastRun) })
							: t("noHeartbeat")
					}
				>
					<Value>{workerHealthy ? t("online") : t("offline")}</Value>
				</SettingRow>
				<SettingRow
					label={t("aiImport")}
					meta={
						sidecarStatus?.online
							? formatUptime(sidecarStatus.uptime ?? 0)
							: t("notConfigured")
					}
				>
					<Value>
						{sidecarStatus?.importerAvailable ? t("enabled") : t("disabled")}
					</Value>
				</SettingRow>
				<SettingRow
					label={t("importQueue")}
					meta={t("waiting", { count: importQueueStats?.totalQueued ?? 0 })}
				>
					<Value>
						{`${importQueueStats?.currentProcessing ?? 0} / ${importQueueStats?.maxConcurrent ?? 3}`}
					</Value>
				</SettingRow>
				<SettingRow
					label={t("backups")}
					meta={
						lastBackupDate
							? t("ago", { time: formatDistanceToNow(lastBackupDate) })
							: t("never")
					}
				>
					<Value>{backupWord}</Value>
				</SettingRow>
			</SettingRows>
		</Section>
	);
}
