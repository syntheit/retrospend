"use client";

import { formatDistanceToNow } from "date-fns";
import { useTranslations } from "next-intl";
import { Section } from "~/components/layout/section";
import { StatusDot } from "~/components/ui/status-dot";
import type { StatusKind } from "~/components/ui/status-map";
import { SettingRow, SettingRows } from "~/features/settings/setting-row";
import { formatUptime } from "~/lib/format";
import type { AutoPostState } from "~/server/services/recurring-auto-post-status";
import { api } from "~/trpc/react";

const WORKER_FRESH_MS = 20 * 60 * 1000;

/** Each state the server reports, as a kind of the one status map and its word. */
const AUTO_POST_KIND: Record<AutoPostState, StatusKind> = {
	healthy: "confirmed",
	attention: "review",
	failing: "error",
	stale: "overdue",
	off: "notCounted",
};

const AUTO_POST_WORD = {
	healthy: "autoPostHealthy",
	attention: "autoPostAttention",
	failing: "autoPostFailing",
	stale: "autoPostStale",
	off: "autoPostOff",
} as const satisfies Record<AutoPostState, string>;

function Value({ children }: { children: React.ReactNode }) {
	return <span className="text-fg text-body tabular-nums">{children}</span>;
}

/**
 * How the server is doing, one row each: the sidecar, AI import, the import
 * queue, recurring expenses and backups (the database size is a figure at the
 * top of the page). The recurring row is a status dot plus its word, decided on the server.
 */
export function AdminOverviewStats() {
	const t = useTranslations("admin");
	const tp = useTranslations("adminPage");
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
	const { data: autoPost } = api.system.getAutoPostStatus.useQuery(undefined, {
		refetchInterval: 60000,
	});
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

	const autoPostMeta = () => {
		if (!autoPost) return null;
		if (autoPost.state === "off") return tp("autoPostOffBy");
		if (!autoPost.lastRun || !autoPost.counts) return tp("autoPostNoRun");
		const { posted, failed, missingRate, capped } = autoPost.counts;
		const parts = [
			posted > 0 && tp("autoPostPosted", { count: posted }),
			failed > 0 && tp("autoPostFailed", { count: failed }),
			missingRate > 0 && tp("autoPostMissingRate", { count: missingRate }),
			capped > 0 && tp("autoPostCapped", { count: capped }),
		].filter((part): part is string => part !== false);
		const time = formatDistanceToNow(new Date(autoPost.lastRun));
		return parts.reduce(
			(head, tail) => tp("autoPostJoin", { head, tail }),
			tp("autoPostRan", { time }),
		);
	};

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
				<SettingRow label={tp("autoPostLabel")} meta={autoPostMeta()}>
					{autoPost && (
						<StatusDot
							kind={AUTO_POST_KIND[autoPost.state]}
							label={tp(AUTO_POST_WORD[autoPost.state])}
						/>
					)}
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
