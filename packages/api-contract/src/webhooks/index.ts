import * as z from "zod";
import { v1 } from "../common/meta";
import { cursorQuerySchema, pageOf } from "../common/pagination";
import { userText } from "../common/user-text";
import { idParamsSchema, idSchema, okSchema, timestampSchema } from "../core";

export const MAX_WEBHOOKS_PER_USER = 10;
export const MAX_WEBHOOK_EVENT_TYPES = 50;
/** The longest a replaced signing secret may keep signing: seven days. */
export const MAX_SECRET_GRACE_SECONDS = 7 * 24 * 60 * 60;

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
		/** Only the origin (`https://host/***`) for a credential without `write:settings`: a URL often holds a token. */
		url: z.string(),
		eventTypes: z.array(z.string()),
		enabled: z.boolean(),
		/** The first characters of the secret, to tell secrets apart. */
		secretStart: z.string(),
		/** While in the future, deliveries are also signed with the secret this one replaced. */
		previousSecretExpiresAt: timestampSchema.nullable(),
		disabledReason: z.enum(WEBHOOK_DISABLED_REASONS).nullable(),
		disabledAt: timestampSchema.nullable(),
		/** Deliveries that ran out of retries since the last success; 5 switch the webhook off. */
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

export const rotateWebhookSecretInputSchema = idParamsSchema.extend({
	graceSeconds: z
		.int()
		.min(0)
		.max(MAX_SECRET_GRACE_SECONDS)
		.default(0)
		.meta({
			description:
				"Seconds the old secret keeps signing next to the new one (at most 7 days). 0, the default, stops it at once: use that when the secret leaked.",
		}),
});

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
const DELIVERY_NOTE = [
	"Each delivery is a POST of one event (the body is the Event without its cursor), signed in the Retrospend-Signature header as `t=<unix seconds>,v1=<hex>`, where v1 is HMAC-SHA256 over `<t>.<raw body>` with the secret.",
	"Reject a timestamp more than 300 seconds from your clock.",
	"While a rotated secret is in its grace period the header holds one v1 entry per secret (`t=<seconds>,v1=<new>,v1=<old>`): accept the delivery when any of them matches.",
	"Delivery is at least once and not ordered: dedupe on the Retrospend-Event-Id header (the event id).",
	"A non-2xx answer or a timeout is retried after 1, 2, 4 ... minutes (at most 6 hours) for 10 attempts; a webhook whose last 5 deliveries ran out of retries is switched off.",
	"Redirects are not followed.",
	"Secrets are encrypted with a key derived from the server's BETTER_AUTH_SECRET: if the operator changes it, deliveries fail as `secret_unreadable` until you rotate the secret.",
].join(" ");
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
			description: `${DELIVERY_NOTE} ${SECRET_NOTE}`,
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
			description: `The old secret stops working at once, unless graceSeconds asks to keep it signing for a while (deliveries then carry both signatures). Rotating again inside the grace period drops the older secret. ${SECRET_NOTE}`,
		})
		.meta({
			scope: "write:settings",
			event: "webhook.secret_rotated",
			secretResponse: true,
		})
		.input(rotateWebhookSecretInputSchema)
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
