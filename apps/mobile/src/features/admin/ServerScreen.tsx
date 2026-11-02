import { useState } from "react";
import { useFormatter, useTranslations } from "use-intl";
import { useSession } from "@/auth/session";
import { newClientId } from "@/data/ids";
import { ListGroup, ListRow } from "@/ui/List";
import { Text } from "@/ui/Text";
import { useToast } from "@/ui/Toast";
import { Block, PageState, SettingsPage } from "../settings/parts";
import { backupState, sizeParts, uptimeParts } from "./serverRules";
import { detailOf, useAdminRead } from "./useAdminRead";

/**
 * The server at a glance: accounts, sizes, uptime and the import queue, the
 * exchange rates (with Sync now) and the database backups (with Back up now).
 * Each button asks the server and says what happened in a toast.
 */
export function ServerScreen() {
	const t = useTranslations("mobile.admin.server");
	const format = useFormatter();
	const { api } = useSession();
	const toast = useToast();
	const [busy, setBusy] = useState<"rates" | "backup" | null>(null);
	const { state, reload } = useAdminRead(async (client) => {
		const [stats, backups, rates] = await Promise.all([
			client.admin.stats(),
			client.admin.getBackups(),
			client.currencies.syncStatus(),
		]);
		return { stats, backups, rates };
	});

	if (state.status !== "ready") {
		return (
			<PageState
				failed={state.status === "error"}
				onRetry={() => void reload()}
			/>
		);
	}
	const { stats, backups, rates } = state.data;
	const queue = stats.importQueue;
	const size = (bytes: number) => {
		const { value, unit } = sizeParts(bytes);
		return `${format.number(value, { maximumFractionDigits: 1 })} ${unit}`;
	};
	const number = (n: number) => format.number(n);
	const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });
	const uptime = uptimeParts(stats.uptimeSeconds);
	const state_ = backupState(backups);
	const last = backups.lastBackup;

	async function run(
		which: "rates" | "backup",
		go: (key: { context: { idempotencyKey: string } }) => Promise<unknown>,
		done: string,
		failed: string,
	) {
		if (!api || busy) return;
		setBusy(which);
		try {
			await go({ context: { idempotencyKey: newClientId() } });
			toast.show({ message: done });
			await reload();
		} catch (error) {
			toast.show({ message: detailOf(error) ?? failed });
		} finally {
			setBusy(null);
		}
	}

	const value = (text: string) => <Text tone="fg2">{text}</Text>;

	return (
		<SettingsPage>
			<Block title={t("overview")}>
				<ListGroup>
					<ListRow end={value(number(stats.userCount))} title={t("accounts")} />
					<ListRow
						end={value(size(stats.databaseSizeBytes))}
						title={t("database")}
					/>
					<ListRow
						end={value(size(stats.storageSizeBytes))}
						title={t("storage")}
					/>
					<ListRow
						end={value(
							uptime.days > 0
								? t("uptimeDays", uptime)
								: t("uptimeHours", uptime),
						)}
						title={t("uptime")}
					/>
				</ListGroup>
			</Block>
			<Block title={t("imports")}>
				<ListGroup>
					<ListRow
						end={value(
							t("importsRunning", {
								current: queue.currentProcessing,
								max: queue.maxConcurrent,
							}),
						)}
						title={t("importsNow")}
					/>
					<ListRow end={value(number(queue.totalQueued))} title={t("queued")} />
					<ListRow
						end={value(number(queue.totalReadyForReview))}
						title={t("ready")}
					/>
					<ListRow
						end={value(number(queue.totalReviewing))}
						title={t("reviewing")}
					/>
				</ListGroup>
			</Block>
			<Block title={t("rates")}>
				<ListGroup>
					<ListRow
						end={value(
							rates.latestRateDate ? day(rates.latestRateDate) : t("never"),
						)}
						title={t("latestRates")}
					/>
					<ListRow
						onPress={
							busy
								? undefined
								: () =>
										void run(
											"rates",
											(call) => api?.currencies.sync(undefined, call) ?? Promise.resolve(),
											t("ratesRequested"),
											t("ratesFailed"),
										)
						}
						title={busy === "rates" ? t("syncing") : t("syncNow")}
					/>
				</ListGroup>
			</Block>
			<Block title={t("backups")}>
				<ListGroup>
					<ListRow
						end={value(t(`backupState.${state_}`))}
						title={t("backupStatus")}
					/>
					{last ? (
						<ListRow
							end={value(day(last.timestamp))}
							sub={last.success ? size(last.sizeBytes) : last.error}
							title={t("lastBackup")}
						/>
					) : null}
					{backups.available && backups.totalBackups !== undefined ? (
						<ListRow
							end={value(number(backups.totalBackups))}
							sub={
								backups.totalSize !== undefined
									? size(backups.totalSize)
									: undefined
							}
							title={t("totalBackups")}
						/>
					) : null}
					{backups.available && backups.retentionDays !== undefined ? (
						<ListRow
							end={value(t("days", { count: backups.retentionDays }))}
							title={t("retention")}
						/>
					) : null}
					{backups.available ? (
						<ListRow
							onPress={
								busy || backups.running
									? undefined
									: () =>
											void run(
												"backup",
												(call) =>
													api?.admin.startBackup(undefined, call) ?? Promise.resolve(),
												t("backupStarted"),
												t("backupFailed"),
											)
							}
							title={busy === "backup" ? t("backingUp") : t("backupNow")}
						/>
					) : null}
				</ListGroup>
			</Block>
		</SettingsPage>
	);
}
