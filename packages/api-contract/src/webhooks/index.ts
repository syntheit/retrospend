import * as z from "zod";
import { v1 } from "../common/meta";
import { cursorQuerySchema, pageOf } from "../common/pagination";
import { userText } from "../common/user-text";
import { idParamsSchema, idSchema, okSchema, timestampSchema } from "../core";

export const MAX_WEBHOOKS_PER_USER = 10;
export const MAX_WEBHOOK_EVENT_TYPES = 50;

/** `expense.created`, or `expense.*` for every event of one resource. */
export const WEBHOOK_EVENT_FILTER_PATTERN =
	/^[a-z][a-z0-9_]*\.([a-z][a-z0-9_]*|\*)$/;

/** The header that carries the signature: `t=<unix seconds>,v1=<hex>`. */
export const WEBHOOK_SIGNATURE_HEADER = "Retrospend-Signature";

/** Why a webhook stopped receiving events. */
export const WEBHOOK_DISABLED_REASONS = [
	"too_many_failures",
	"blocked_target",
	"manual",
] as const;

export const webhookDeliveryStatusSchema = z
	.enum(["pending", "succeeded", "failed"])
	.meta({ id: "WebhookDeliveryStatus" });

const eventFilterSchema = z
	.array(z.string().regex(WEBHOOK_EVENT_FILTER_PATTERN))
	.max(MAX_WEBHOOK_EVENT_TYPES)
	.meta({
		description:
			"Event types to send: exact (`expense.created`) or per resource (`expense.*`). Empty means every type.",
	});

const webhookUrlSchema = z.url().max(2048).meta({
	description:
		"An https URL. It must resolve to a public address unless an admin allows private targets.",
});

export const webhookSchema = z
	.object({
		id: idSchema,
		name: z.string(),
		url: z.string(),
		eventTypes: z.array(z.string()),
		enabled: z.boolean(),
		/** The first characters of the secret, to tell secrets apart. */
		secretStart: z.string(),
		disabledReason: z.enum(WEBHOOK_DISABLED_REASONS).nullable(),
		disabledAt: timestampSchema.nullable(),
		/** Failed attempts since the last success. */
		consecutiveFailures: z.int(),
		createdAt: timestampSchema,
		updatedAt: timestampSchema,
	})
	.meta({ id: "Webhook" });

export type WebhookDto = z.infer<typeof webhookSchema>;

export const createWebhookSchema = z
	.object({
		name: userText("webhook.name", 100),
		url: webhookUrlSchema,
		eventTypes: eventFilterSchema.default([]),
	})
	.meta({ id: "CreateWebhook" });

export const updateWebhookSchema = z
	.object({
		name: userText("webhook.name", 100).optional(),
		url: webhookUrlSchema.optional(),
		eventTypes: eventFilterSchema.optional(),
		enabled: z.boolean().optional().meta({
			description: "Turning a disabled webhook back on clears its failures.",
		}),
	})
	.meta({ id: "UpdateWebhook" });

export const updateWebhookInputSchema = idParamsSchema.extend(
	updateWebhookSchema.shape,
);

/** The webhook plus its signing secret, shown this once. */
export const webhookWithSecretSchema = z
	.object({
		webhook: webhookSchema,
		/** Verify deliveries with it: HMAC-SHA256 over `<t>.<body>`. */
		secret: z.string(),
	})
	.meta({ id: "WebhookWithSecret" });

export const webhookDeliverySchema = z
	.object({
		id: idSchema,
		webhookId: idSchema,
		/** Null for a test delivery. */
		eventId: idSchema.nullable(),
		eventType: z.string(),
		status: webhookDeliveryStatusSchema,
		attempts: z.int(),
		nextAttemptAt: timestampSchema.nullable(),
		lastAttemptAt: timestampSchema.nullable(),
		lastStatusCode: z.int().nullable(),
		/** A short code (`timeout`, `http_error`, `blocked_target`), never the response. */
		lastError: z.string().nullable(),
		deliveredAt: timestampSchema.nullable(),
		createdAt: timestampSchema,
	})
	.meta({ id: "WebhookDelivery" });

export type WebhookDeliveryDto = z.infer<typeof webhookDeliverySchema>;

const TAG = ["Webhooks"];
const SECRET_NOTE =
	"The secret is in this response only; a replayed Idempotency-Key answers idempotency_replay_unavailable.";

export const webhooksContract = {
	list: v1
		.route({
			method: "GET",
			path: "/webhooks",
			operationId: "listWebhooks",
			tags: TAG,
			summary: "The caller's webhooks, newest first",
		})
		.meta({ scope: "read" })
		.input(cursorQuerySchema)
		.output(pageOf(webhookSchema)),
	get: v1
		.route({
			method: "GET",
			path: "/webhooks/{id}",
			operationId: "getWebhook",
			tags: TAG,
			summary: "One webhook",
		})
		.meta({ scope: "read" })
		.input(idParamsSchema)
		.output(webhookSchema),
	create: v1
		.route({
			method: "POST",
			path: "/webhooks",
			operationId: "createWebhook",
			tags: TAG,
			summary: "Create a webhook",
			description: `Deliveries are POSTs of an event, signed with HMAC-SHA256 in the Retrospend-Signature header, retried with backoff and switched off after repeated failures. ${SECRET_NOTE}`,
			successStatus: 201,
		})
		.meta({
			scope: "write:settings",
			event: "webhook.created",
			secretResponse: true,
		})
		.input(createWebhookSchema)
		.output(webhookWithSecretSchema),
	update: v1
		.route({
			method: "PATCH",
			path: "/webhooks/{id}",
			operationId: "updateWebhook",
			tags: TAG,
			summary: "Change a webhook's name, URL, event types or on/off state",
		})
		.meta({ scope: "write:settings", event: "webhook.updated" })
		.input(updateWebhookInputSchema)
		.output(webhookSchema),
	delete: v1
		.route({
			method: "DELETE",
			path: "/webhooks/{id}",
			operationId: "deleteWebhook",
			tags: TAG,
			summary: "Delete a webhook and its delivery log",
		})
		.meta({ scope: "write:settings", event: "webhook.deleted" })
		.input(idParamsSchema)
		.output(okSchema),
	rotateSecret: v1
		.route({
			method: "POST",
			path: "/webhooks/{id}/rotate-secret",
			operationId: "rotateWebhookSecret",
			tags: TAG,
			summary: "Replace the signing secret",
			description: `The old secret stops working at once. ${SECRET_NOTE}`,
		})
		.meta({
			scope: "write:settings",
			event: "webhook.secret_rotated",
			secretResponse: true,
		})
		.input(idParamsSchema)
		.output(webhookWithSecretSchema),
	test: v1
		.route({
			method: "POST",
			path: "/webhooks/{id}/test",
			operationId: "testWebhook",
			tags: TAG,
			summary: "Send a test event now",
			description:
				"One signed `webhook.test` delivery, made before the response. It is logged, is not retried and does not count toward switching the webhook off.",
		})
		.meta({ scope: "write:settings", event: "webhook.tested" })
		.input(idParamsSchema)
		.output(webhookDeliverySchema),
	deliveries: v1
		.route({
			method: "GET",
			path: "/webhooks/{id}/deliveries",
			operationId: "listWebhookDeliveries",
			tags: TAG,
			summary: "The delivery log of a webhook, newest first",
		})
		.meta({ scope: "read" })
		.input(idParamsSchema.extend(cursorQuerySchema.shape))
		.output(pageOf(webhookDeliverySchema)),
};
