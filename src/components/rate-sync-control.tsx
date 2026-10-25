"use client";

import { formatDistanceToNow } from "date-fns";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Section } from "~/components/layout/section";
import { Button } from "~/components/ui/button";
import { SettingRow, SettingRows } from "~/features/settings/setting-row";
import { api } from "~/trpc/react";

/** Exchange rates: when they last synced and one Sync now. */
export function RateSyncControl() {
	const t = useTranslations("currencies");
	const [syncResult, setSyncResult] = useState<{
		success: boolean;
		unavailable?: boolean;
		message: string;
	} | null>(null);

	const utils = api.useUtils();
	const { data: lastSync, isLoading } = api.exchangeRate.getLastSync.useQuery();
	const syncNow = api.exchangeRate.syncNow.useMutation({
		onSuccess: () => {
			void utils.exchangeRate.getAllRates.invalidate();
			void utils.exchangeRate.getLastSync.invalidate();
		},
	});

	const handleSyncNow = async () => {
		setSyncResult(null);
		try {
			setSyncResult(await syncNow.mutateAsync());
		} catch (error) {
			setSyncResult({
				success: false,
				message: error instanceof Error ? error.message : t("syncFailed"),
			});
		}
	};

	return (
		<Section
			end={
				<Button
					disabled={syncNow.isPending}
					kind="secondary"
					loading={syncNow.isPending}
					onClick={handleSyncNow}
					size="sm"
				>
					{syncNow.isPending ? t("syncing") : t("syncNow")}
				</Button>
			}
			title={t("exchangeRateSync")}
		>
			<p className="text-fg-3 text-small mb-2">
				{t("exchangeRateSyncDescription")}
			</p>
			<SettingRows>
				<SettingRow label={t("lastSynced")}>
					<span className="text-fg text-body tabular-nums">
						{isLoading
							? t("loadingRates")
							: lastSync
								? formatDistanceToNow(lastSync, { addSuffix: true })
								: t("never")}
					</span>
				</SettingRow>
			</SettingRows>
			{/* No sidecar on this server: a plain sentence, not a failure. */}
			{syncResult?.unavailable ? (
				<p className="text-fg-2 text-small mt-2" role="status">
					{t("syncUnavailable")}
				</p>
			) : syncResult ? (
				<p
					className={`text-small mt-2 ${syncResult.success ? "text-fg-2" : "text-danger"}`}
					role="status"
				>
					{syncResult.message}
				</p>
			) : null}
		</Section>
	);
}
