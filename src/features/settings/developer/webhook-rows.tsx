"use client";

import type { WebhookDto } from "@retrospend/api-contract";
import { Webhook } from "lucide-react";
import { useTranslations } from "next-intl";
import { ActionMenu } from "~/components/actions/action-menu";
import type { ActionHandlers } from "~/components/actions/types";
import type { WebhookTarget } from "~/components/actions/webhook";
import { IconTile, Row, RowSub } from "~/components/rows/row";
import { StatusDot } from "~/components/ui/status-dot";
import { stateOf, targetOf } from "./webhooks";

/** One webhook: its name and state, where it posts and which events it gets. */
export function WebhookRow({
	webhook: w,
	handlers,
}: {
	webhook: WebhookDto;
	handlers: ActionHandlers<WebhookTarget>;
}) {
	const t = useTranslations("settingsV2.developer");
	const state = stateOf(w);
	return (
		<Row
			actions={
				<ActionMenu
					entity="webhook"
					handlers={handlers}
					target={{ id: w.id, name: w.name, enabled: w.enabled }}
				/>
			}
			lead={<IconTile icon={Webhook} />}
			sub={
				<RowSub
					parts={[
						<span className="font-mono" key="host">
							{targetOf(w.url)}
						</span>,
						w.eventTypes.length === 0
							? t("events.all")
							: t("events.count", { count: w.eventTypes.length }),
					]}
				/>
			}
			title={w.name}
			titleEnd={
				state.kind === "off" ? (
					<StatusDot
						kind={state.status}
						label={t(`webhookState.${state.reason}`)}
						size="sm"
					/>
				) : null
			}
		/>
	);
}
