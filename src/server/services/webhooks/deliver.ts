import {
	eventDataSchema,
	WEBHOOK_SIGNATURE_HEADER,
} from "@retrospend/api-contract";
import type { ApiEvent, Webhook } from "~prisma";
import { decryptSecret, signWebhook } from "./secret";
import { type SendResult, sendWebhook } from "./send";
import type { Resolver } from "./ssrf";

export type DeliveryOptions = {
	allowPrivate: boolean;
	/** Injected by tests; production resolves through DNS. */
	resolve?: Resolver;
	timeoutMs?: number;
	now?: Date;
};

/**
 * The body of a delivery: an ApiEvent (as `GET /events` returns it) without
 * its feed cursor. Ids, types and amounts only; the receiver fetches the
 * resource for its current text.
 */
export function eventBody(event: ApiEvent): string {
	const data = eventDataSchema.safeParse(event.payload);
	return JSON.stringify({
		id: event.id,
		type: event.type,
		occurredAt: event.createdAt.toISOString(),
		actorUserId: event.actorUserId,
		entity:
			event.entityType && event.entityId
				? { type: event.entityType, id: event.entityId }
				: null,
		data: data.success ? data.data : { ids: {}, amounts: [], truncated: false },
	});
}

export function testEventBody(id: string, at: Date): string {
	return JSON.stringify({
		id,
		type: "webhook.test",
		occurredAt: at.toISOString(),
		actorUserId: null,
		entity: null,
		data: { ids: {}, amounts: [], truncated: false },
	});
}

/** One signed attempt against the webhook's URL. */
export function deliverOnce(
	webhook: Pick<Webhook, "url" | "secretCipher">,
	delivery: {
		id: string;
		eventId: string | null;
		eventType: string;
		body: string;
	},
	options: DeliveryOptions,
): Promise<SendResult> {
	const seconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
	let signature: string;
	try {
		signature = signWebhook(
			decryptSecret(webhook.secretCipher),
			delivery.body,
			seconds,
		);
	} catch {
		// The key the secret was encrypted with is gone (BETTER_AUTH_SECRET
		// changed). Nothing can be sent until the owner rotates the secret.
		return Promise.resolve({
			ok: false,
			error: "secret_unreadable",
			statusCode: null,
		});
	}
	return sendWebhook({
		url: webhook.url,
		body: delivery.body,
		allowPrivate: options.allowPrivate,
		resolve: options.resolve,
		timeoutMs: options.timeoutMs,
		headers: {
			"Content-Type": "application/json",
			"User-Agent": "Retrospend-Webhooks/1",
			"Retrospend-Delivery-Id": delivery.id,
			"Retrospend-Event-Id": delivery.eventId ?? delivery.id,
			"Retrospend-Event-Type": delivery.eventType,
			[WEBHOOK_SIGNATURE_HEADER]: signature,
		},
	});
}
