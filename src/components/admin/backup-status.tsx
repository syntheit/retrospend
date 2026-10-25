"use client";

import { formatDistanceToNow } from "date-fns";
import { useTranslations } from "next-intl";
import { Section } from "~/components/layout/section";
import { Button } from "~/components/ui/button";
import { Skeleton } from "~/components/ui/skeleton";
import { useToast } from "~/components/ui/toast";
import { SettingRow, SettingRows } from "~/features/settings/setting-row";
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

function Value({ children }: { children: React.ReactNode }) {
	return <span className="text-fg text-body tabular-nums">{children}</span>;
}

const ago = (date: Date) => formatDistanceToNow(date, { addSuffix: true });

/** Database backups: status rows, the last few runs and one Back up now. */
export function BackupStatus() {
	const t = useTranslations("admin");
	const toast = useToast();
	const { data, isLoading } = api.admin.getBackupStatus.useQuery(undefined, {
		refetchInterval: 60000,
	});
	const utils = api.useUtils();
	const trigger = api.admin.triggerBackup.useMutation({
		onSuccess: () => {
			toast.saved(t("backupStartedSuccess"));
			// A moment later, so the running state shows.
			setTimeout(() => void utils.admin.getBackupStatus.invalidate(), 2000);
		},
		onError: (error) => toast.failed(error.message),
	});
	const status = data as BackupStatusData | undefined;

	if (isLoading) {
		return (
			<Section title={t("databaseBackups")}>
				<Skeleton className="h-ctl w-40" shape="line" />
			</Section>
		);
	}

	if (!status?.available) {
		return (
			<Section title={t("databaseBackups")}>
				<p className="text-fg-2 text-small">{t("backupServiceUnavailable")}</p>
			</Section>
		);
	}

	const last = status.lastBackup;
	const busy = trigger.isPending || status.running;
	const word = status.running
		? t("running")
		: last?.success
			? t("healthy")
			: last
				? t("failed")
				: t("neverRun");

	return (
		<Section
			end={
				<Button
					disabled={busy}
					kind="secondary"
					loading={busy}
					onClick={() => trigger.mutate()}
					size="sm"
				>
					{busy ? t("backingUp") : t("backupNow")}
				</Button>
			}
			title={t("databaseBackups")}
		>
			<p className="text-fg-3 text-small mb-2">
				{t("autoBackupRetention", { days: status.retentionDays ?? 0 })}
			</p>
			<SettingRows>
				<SettingRow label={t("backupStatus")}>
					<Value>{word}</Value>
				</SettingRow>
				<SettingRow label={t("lastBackup")}>
					<Value>{last ? ago(new Date(last.timestamp)) : t("never")}</Value>
				</SettingRow>
				{last?.success && (
					<SettingRow label={t("backupSize")}>
						<Value>{formatBytes(last.sizeBytes)}</Value>
					</SettingRow>
				)}
				<SettingRow label={t("nextScheduled")}>
					<Value>
						{status.nextScheduled
							? ago(new Date(status.nextScheduled))
							: t("notAvailable")}
					</Value>
				</SettingRow>
				<SettingRow label={t("totalBackupsLabel")}>
					<Value>
						{status.totalBackups ?? 0} ({formatBytes(status.totalSize ?? 0)})
					</Value>
				</SettingRow>
			</SettingRows>
			{status.history && status.history.length > 0 && (
				<div className="mt-6">
					<h3 className="text-fg-2 text-small mb-1 font-semibold">
						{t("recentHistory")}
					</h3>
					<SettingRows>
						{status.history.slice(0, 5).map((entry) => (
							<SettingRow
								key={entry.filename || entry.timestamp}
								label={ago(new Date(entry.timestamp))}
								meta={t("backupDuration", {
									seconds: Math.round(entry.durationMs / 1000),
								})}
							>
								<Value>
									{entry.success ? formatBytes(entry.sizeBytes) : t("failed")}
								</Value>
							</SettingRow>
						))}
					</SettingRows>
				</div>
			)}
		</Section>
	);
}
