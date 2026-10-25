import {
	type CursorQuery,
	type createWebhookSchema,
	MAX_WEBHOOKS_PER_USER,
	type updateWebhookInputSchema,
	type WebhookDeliveryDto,
	type WebhookDto,
} from "@retrospend/api-contract";
import { TRPCError } from "@trpc/server";
import * as z from "zod";
import { generateId } from "~/lib/id";
import { db } from "~/server/db";
import type { Caller } from "~/server/services/api-v1/caller";
import { decodeCursor, toPage } from "~/server/services/api-v1/cursor";
import { getAppSettings } from "~/server/services/settings";
import { deliverOnce, testEventBody } from "./deliver";
import { toDeliveryDto, toWebhookDto } from "./dto";
import { encryptSecret, generateWebhookSecret } from "./secret";
import { checkWebhookTarget, type Resolver } from "./ssrf";

type CreateInput = z.infer<typeof createWebhookSchema>;
type UpdateInput = z.infer<typeof updateWebhookInputSchema>;

export type TargetPolicy = { resolve?: Resolver; allowPrivate?: boolean };

const pageKey = z.object({ createdAt: z.iso.datetime(), id: z.string() });

async function allowPrivate(policy: TargetPolicy): Promise<boolean> {
	return (
		policy.allowPrivate ?? (await getAppSettings()).webhooksAllowPrivateTargets
	);
}

async function validateTarget(url: string, policy: TargetPolicy) {
	await checkWebhookTarget(url, {
		allowPrivate: await allowPrivate(policy),
		resolve: policy.resolve,
	});
}

const notFound = () =>
	new TRPCError({ code: "NOT_FOUND", message: "No such webhook" });

async function ownWebhook(caller: Caller, id: string) {
	const row = await caller.db.webhook.findFirst({
		where: { id, userId: caller.principal.userId },
	});
	if (!row) throw notFound();
	return row;
}

export async function listWebhookPage(caller: Caller, query: CursorQuery) {
	const after = decodeCursor(query.cursor, pageKey);
	const rows = await caller.db.webhook.findMany({
		where: {
			userId: caller.principal.userId,
			...(after
				? {
						OR: [
							{ createdAt: { lt: new Date(after.createdAt) } },
							{ createdAt: new Date(after.createdAt), id: { lt: after.id } },
						],
					}
				: {}),
		},
		orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		take: query.limit + 1,
	});
	return toPage(
		rows,
		query.limit,
		(r) => ({ createdAt: r.createdAt.toISOString(), id: r.id }),
		toWebhookDto,
	);
}

export async function getWebhook(caller: Caller, id: string) {
	return toWebhookDto(await ownWebhook(caller, id));
}

export async function createWebhook(
	caller: Caller,
	input: CreateInput,
	policy: TargetPolicy = {},
): Promise<{ webhook: WebhookDto; secret: string }> {
	const userId = caller.principal.userId;
	if (
		(await caller.db.webhook.count({ where: { userId } })) >=
		MAX_WEBHOOKS_PER_USER
	)
		throw new TRPCError({
			code: "CONFLICT",
			message: `You can have up to ${MAX_WEBHOOKS_PER_USER} webhooks`,
		});
	await validateTarget(input.url, policy);
	const { secret, start } = generateWebhookSecret();
	const row = await caller.db.webhook.create({
		data: {
			id: generateId(),
			userId,
			name: input.name,
			url: input.url,
			eventTypes: [...new Set(input.eventTypes)],
			secretCipher: encryptSecret(secret),
			secretStart: start,
		},
	});
	return { webhook: toWebhookDto(row), secret };
}

export async function updateWebhook(
	caller: Caller,
	input: UpdateInput,
	policy: TargetPolicy = {},
): Promise<WebhookDto> {
	const current = await ownWebhook(caller, input.id);
	// Turning it on again starts a clean count; turning it off is the owner's choice.
	const enabling = input.enabled === true && !current.enabled;
	const disabling = input.enabled === false && current.enabled;
	const urlChanged = input.url !== undefined && input.url !== current.url;
	// A webhook coming back on is checked again: the policy may have changed.
	if (urlChanged || enabling)
		await validateTarget(input.url ?? current.url, policy);
	const row = await caller.db.webhook.update({
		where: { id: current.id },
		data: {
			name: input.name,
			url: input.url,
			eventTypes: input.eventTypes && [...new Set(input.eventTypes)],
			...(enabling
				? {
						enabled: true,
						consecutiveFailures: 0,
						disabledAt: null,
						disabledReason: null,
					}
				: {}),
			...(disabling
				? { enabled: false, disabledAt: new Date(), disabledReason: "manual" }
				: {}),
		},
	});
	return toWebhookDto(row);
}

export async function deleteWebhook(caller: Caller, id: string) {
	const row = await ownWebhook(caller, id);
	await caller.db.webhook.delete({ where: { id: row.id } });
	return { ok: true as const };
}

export async function rotateWebhookSecret(
	caller: Caller,
	id: string,
): Promise<{ webhook: WebhookDto; secret: string }> {
	const current = await ownWebhook(caller, id);
	const { secret, start } = generateWebhookSecret();
	const row = await caller.db.webhook.update({
		where: { id: current.id },
		data: { secretCipher: encryptSecret(secret), secretStart: start },
	});
	return { webhook: toWebhookDto(row), secret };
}

export async function listDeliveryPage(
	caller: Caller,
	id: string,
	query: CursorQuery,
) {
	const hook = await ownWebhook(caller, id);
	const after = decodeCursor(query.cursor, pageKey);
	const rows = await caller.db.webhookDelivery.findMany({
		where: {
			webhookId: hook.id,
			...(after
				? {
						OR: [
							{ createdAt: { lt: new Date(after.createdAt) } },
							{ createdAt: new Date(after.createdAt), id: { lt: after.id } },
						],
					}
				: {}),
		},
		orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		take: query.limit + 1,
	});
	return toPage(
		rows,
		query.limit,
		(r) => ({ createdAt: r.createdAt.toISOString(), id: r.id }),
		toDeliveryDto,
	);
}

/**
 * One signed `webhook.test` delivery, made now and logged. It is not
 * retried and does not count toward switching the webhook off. The log row
 * is written by the server, as the app role may only read the log.
 */
export async function testWebhook(
	caller: Caller,
	id: string,
	policy: TargetPolicy = {},
): Promise<WebhookDeliveryDto> {
	const hook = await ownWebhook(caller, id);
	const now = new Date();
	const deliveryId = generateId();
	const result = await deliverOnce(
		hook,
		{
			id: deliveryId,
			eventId: null,
			eventType: "webhook.test",
			body: testEventBody(deliveryId, now),
		},
		{
			allowPrivate: await allowPrivate(policy),
			resolve: policy.resolve,
			now,
		},
	);
	const row = await db.webhookDelivery.create({
		data: {
			id: deliveryId,
			webhookId: hook.id,
			userId: hook.userId,
			eventType: "webhook.test",
			status: result.ok ? "SUCCEEDED" : "FAILED",
			attempts: 1,
			lastAttemptAt: now,
			lastStatusCode: result.statusCode,
			lastError: result.ok ? null : result.error,
			deliveredAt: result.ok ? now : null,
		},
	});
	return toDeliveryDto(row);
}
