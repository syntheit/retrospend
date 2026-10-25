"use client";

import { useApi } from "@retrospend/api-client/react";
import type { WebhookDeliveryDto } from "@retrospend/api-contract";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";
import { Row, RowList, RowSub } from "~/components/rows/row";
import { Button } from "~/components/ui/button";
import { Empty } from "~/components/ui/empty-state";
import { Sheet } from "~/components/ui/sheet";
import { SkeletonRows } from "~/components/ui/skeleton";
import { StatusDot } from "~/components/ui/status-dot";
import { SectionUnavailable } from "../section-shell";
import { deliveryStatus } from "./webhooks";

/** The delivery log of one webhook, newest first, 50 at a time. */
export function DeliveriesSheet({
	webhook,
	open,
	onOpenChange,
}: {
	webhook: { id: string; name: string } | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const t = useTranslations("settingsV2.developer");
	return (
		<Sheet
			cancelLabel={t("close")}
			detent="large"
			onOpenChange={onOpenChange}
			open={open}
			title={t("deliveriesTitle", { name: webhook?.name ?? "" })}
		>
			{webhook ? <DeliveryList id={webhook.id} /> : null}
		</Sheet>
	);
}

function DeliveryList({ id }: { id: string }) {
	const t = useTranslations("settingsV2.developer");
	const { utils } = useApi();
	const log = useInfiniteQuery(
		utils.webhooks.deliveries.infiniteOptions({
			input: (cursor: string | undefined) => ({ id, cursor, limit: 50 }),
			initialPageParam: undefined,
			getNextPageParam: (page) => page.nextCursor ?? undefined,
		}),
	);
	if (log.isLoading) return <SkeletonRows count={3} />;
	if (log.isError) return <SectionUnavailable onRetry={() => void log.refetch()} />;
	const rows = log.data?.pages.flatMap((p) => p.items) ?? [];
	if (rows.length === 0)
		return <Empty hint={t("noDeliveriesHint")} title={t("noDeliveries")} />;
	return (
		<div className="flex flex-col gap-3">
			<RowList label={t("deliveries")}>
				{rows.map((d) => (
					<DeliveryRow delivery={d} key={d.id} />
				))}
			</RowList>
			{log.hasNextPage ? (
				<Button
					kind="secondary"
					loading={log.isFetchingNextPage}
					onClick={() => void log.fetchNextPage()}
					size="sm"
				>
					{t("showMore")}
				</Button>
			) : null}
		</div>
	);
}

function DeliveryRow({ delivery: d }: { delivery: WebhookDeliveryDto }) {
	const t = useTranslations("settingsV2.developer");
	const format = useFormatter();
	const status = deliveryStatus(d.status);
	const when = new Date(d.lastAttemptAt ?? d.createdAt);
	return (
		<Row
			sub={
				<RowSub
					parts={[
						format.dateTime(when, { dateStyle: "medium", timeStyle: "short" }),
						t("attempts", { count: d.attempts }),
						d.lastStatusCode != null ? `HTTP ${d.lastStatusCode}` : null,
						d.lastError ? (
							<span className="font-mono" key="error">
								{d.lastError}
							</span>
						) : null,
					]}
				/>
			}
			title={<span className="font-mono">{d.eventType}</span>}
			titleEnd={
				<StatusDot
					kind={status.kind}
					label={t(`delivery.${status.word}`)}
					size="sm"
				/>
			}
		/>
	);
}
