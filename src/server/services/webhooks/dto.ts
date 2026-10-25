import {
	WEBHOOK_DISABLED_REASONS,
	type WebhookDeliveryDto,
	type WebhookDto,
} from "@retrospend/api-contract";
import type { Webhook, WebhookDelivery } from "~prisma";

const iso = (d: Date | null) => d?.toISOString() ?? null;

export function toWebhookDto(row: Webhook): WebhookDto {
	const reason = WEBHOOK_DISABLED_REASONS.find((r) => r === row.disabledReason);
	return {
		id: row.id,
		name: row.name,
		url: row.url,
		eventTypes: row.eventTypes,
		enabled: row.enabled,
		secretStart: row.secretStart,
		disabledReason: reason ?? null,
		disabledAt: iso(row.disabledAt),
		consecutiveFailures: row.consecutiveFailures,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

export function toDeliveryDto(row: WebhookDelivery): WebhookDeliveryDto {
	return {
		id: row.id,
		webhookId: row.webhookId,
		eventId: row.eventId,
		eventType: row.eventType,
		status:
			row.status === "SUCCEEDED"
				? "succeeded"
				: row.status === "FAILED"
					? "failed"
					: "pending",
		attempts: row.attempts,
		nextAttemptAt: iso(row.nextAttemptAt),
		lastAttemptAt: iso(row.lastAttemptAt),
		lastStatusCode: row.lastStatusCode,
		lastError: row.lastError,
		deliveredAt: iso(row.deliveredAt),
		createdAt: row.createdAt.toISOString(),
	};
}

/**
 * A webhook URL often carries a secret in its path or query (a chat
 * integration's token), so a credential that can only read sees the origin.
 */
export function maskWebhookUrl(webhook: WebhookDto): WebhookDto {
	try {
		return { ...webhook, url: `${new URL(webhook.url).origin}/***` };
	} catch {
		return { ...webhook, url: "***" };
	}
}
