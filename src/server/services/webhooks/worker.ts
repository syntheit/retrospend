import { env } from "~/env";
import { db } from "~/server/db";
import { getAppSettings } from "~/server/services/settings";
import type { Prisma } from "~prisma";
import { type DeliveryOptions, deliverOnce, eventBody } from "./deliver";
import {
	AUTO_DISABLE_AFTER,
	CLAIM_LEASE_MS,
	RETENTION_DAYS,
	retryDelayMs,
} from "./schedule";
import type { SendResult } from "./send";
import type { Resolver } from "./ssrf";

/**
 * The webhook worker. The app has no queue system, so this follows how the
 * import queue runs (in the web process, started after the work that needs
 * it) and adds three things so a delivery is never stranded:
 * - `startWebhookWorker` (called from instrumentation.ts at boot) sweeps
 *   once and then every minute;
 * - a sweep re-arms itself after 2 seconds while events remain that the
 *   outbox horizon (see feed.ts) has not released yet, and at the next
 *   retry time;
 * - `POST /api/internal/webhooks` (WORKER_API_KEY) runs one sweep for any
 *   scheduler.
 *
 * One sweep (`runWebhookWorker`) does three things, each safe to run from
 * several processes at once:
 * 1. fans new outbox events out into one delivery per matching webhook;
 * 2. attempts the deliveries that are due, claiming each first;
 * 3. prunes what is past retention.
 * Webhook events themselves (`webhook.*`) are never delivered, so a webhook
 * cannot fire on its own changes.
 *
 * Delivery is at least once: a crash between a send and its record sends
 * again. Receivers dedupe on Retrospend-Event-Id.
 *
 * Signing secrets are encrypted with a key derived from BETTER_AUTH_SECRET.
 * Rotating that secret makes every stored webhook secret unreadable: each
 * delivery then fails as `secret_unreadable` until its owner rotates the
 * webhook's secret.
 */

export type WorkerOptions = {
	now?: Date;
	allowPrivate?: boolean;
	resolve?: Resolver;
	timeoutMs?: number;
};

const FAN_OUT_BATCH = 200;
const ATTEMPT_BATCH = 50;
const PARALLEL = 5;
const DAY_MS = 86_400_000;
/** Wake-up while the horizon holds events back. */
const HORIZON_RETRY_MS = 2000;
const SWEEP_EVERY_MS = 60_000;

/** `[]` matches everything; an entry is a full type or `<resource>.*`. */
export function matchesEventFilter(filter: readonly string[], type: string) {
	if (filter.length === 0) return true;
	const resource = type.split(".")[0];
	return filter.some((f) => f === type || f === `${resource}.*`);
}

async function allowPrivateTargets(options: WorkerOptions): Promise<boolean> {
	if (options.allowPrivate !== undefined) return options.allowPrivate;
	return (await getAppSettings()).webhooksAllowPrivateTargets;
}

type OutboxRow = { id: string; userId: string; type: string; createdAt: Date };

/** Turns new events into deliveries. Returns how many events it handled. */
export async function fanOutEvents(): Promise<number> {
	return db.$transaction(async (tx) => {
		// Only events whose transaction is behind the oldest open one, so a
		// late commit is not missed; SKIP LOCKED lets two workers split a batch.
		const events = await tx.$queryRaw<OutboxRow[]>`
			SELECT "id", "userId", "type", "createdAt" FROM "api_event"
			WHERE "fannedOutAt" IS NULL
			  AND "txid" < pg_snapshot_xmin(pg_current_snapshot())
			ORDER BY "txid", "seq"
			LIMIT ${FAN_OUT_BATCH}
			FOR UPDATE SKIP LOCKED`;
		if (events.length === 0) return 0;

		const deliverable = events.filter((e) => !e.type.startsWith("webhook."));
		const hooks = await tx.webhook.findMany({
			where: {
				enabled: true,
				userId: { in: [...new Set(deliverable.map((e) => e.userId))] },
			},
		});
		const now = new Date();
		const rows: Prisma.WebhookDeliveryCreateManyInput[] = [];
		for (const event of deliverable)
			for (const hook of hooks) {
				if (
					hook.userId === event.userId &&
					hook.createdAt <= event.createdAt &&
					matchesEventFilter(hook.eventTypes, event.type)
				)
					rows.push({
						webhookId: hook.id,
						userId: hook.userId,
						eventId: event.id,
						eventType: event.type,
						nextAttemptAt: now,
					});
			}
		await tx.webhookDelivery.createMany({ data: rows, skipDuplicates: true });
		await tx.apiEvent.updateMany({
			where: { id: { in: events.map((e) => e.id) } },
			data: { fannedOutAt: now },
		});
		return events.length;
	});
}

type DueDelivery = Prisma.WebhookDeliveryGetPayload<{
	include: { webhook: true; event: true };
}>;

/**
 * Takes a delivery for this worker by moving its next attempt to a lease
 * time. Returns the lease, which the settle step must still find in place
 * (so a worker that was slow past its lease cannot overwrite the worker
 * that took over), or null when another worker got there first.
 */
async function claim(delivery: DueDelivery, now: Date): Promise<Date | null> {
	const lease = new Date(now.getTime() + CLAIM_LEASE_MS);
	const { count } = await db.webhookDelivery.updateMany({
		where: {
			id: delivery.id,
			status: "PENDING",
			nextAttemptAt: delivery.nextAttemptAt,
		},
		data: { nextAttemptAt: lease },
	});
	return count === 1 ? lease : null;
}

/**
 * A delivery ran out of retries (or the target is blocked). Only these
 * count against the webhook, so a short outage of the receiver, which fails
 * many first attempts but then recovers, never switches it off.
 */
async function recordTerminalFailure(
	webhookId: string,
	blocked: boolean,
	now: Date,
): Promise<void> {
	if (!blocked) {
		const updated = await db.webhook.update({
			where: { id: webhookId },
			data: { consecutiveFailures: { increment: 1 } },
		});
		if (!updated.enabled || updated.consecutiveFailures < AUTO_DISABLE_AFTER)
			return;
	}
	await db.webhook.update({
		where: { id: webhookId },
		data: {
			enabled: false,
			disabledAt: now,
			disabledReason: blocked ? "blocked_target" : "too_many_failures",
		},
	});
	await db.webhookDelivery.updateMany({
		where: { webhookId, status: "PENDING" },
		data: {
			status: "FAILED",
			nextAttemptAt: null,
			lastError: "webhook_disabled",
		},
	});
}

async function settle(
	delivery: DueDelivery,
	result: SendResult,
	now: Date,
	lease: Date,
): Promise<void> {
	const attempts = delivery.attempts + 1;
	const base = { attempts, lastAttemptAt: now };
	const owned = {
		id: delivery.id,
		status: "PENDING" as const,
		nextAttemptAt: lease,
	};
	if (result.ok) {
		const { count } = await db.webhookDelivery.updateMany({
			where: owned,
			data: {
				...base,
				status: "SUCCEEDED",
				nextAttemptAt: null,
				lastStatusCode: result.statusCode,
				lastError: null,
				deliveredAt: now,
			},
		});
		if (count === 1)
			await db.webhook.update({
				where: { id: delivery.webhookId },
				data: { consecutiveFailures: 0 },
			});
		return;
	}
	const blocked = result.error === "blocked_target";
	const wait = blocked ? null : retryDelayMs(attempts);
	const { count } = await db.webhookDelivery.updateMany({
		where: owned,
		data: {
			...base,
			status: wait === null ? "FAILED" : "PENDING",
			nextAttemptAt: wait === null ? null : new Date(now.getTime() + wait),
			lastStatusCode: result.statusCode,
			lastError: result.error,
		},
	});
	if (count === 1 && wait === null)
		await recordTerminalFailure(delivery.webhookId, blocked, now);
}

async function attempt(
	delivery: DueDelivery,
	opts: DeliveryOptions,
	lease: Date,
): Promise<void> {
	const now = opts.now ?? new Date();
	if (!delivery.webhook.enabled || !delivery.event) {
		await db.webhookDelivery.updateMany({
			where: { id: delivery.id, status: "PENDING", nextAttemptAt: lease },
			data: {
				status: "FAILED",
				nextAttemptAt: null,
				lastError: delivery.event ? "webhook_disabled" : "event_gone",
			},
		});
		return;
	}
	const result = await deliverOnce(
		delivery.webhook,
		{
			id: delivery.id,
			eventId: delivery.eventId,
			eventType: delivery.eventType,
			body: eventBody(delivery.event),
		},
		opts,
	);
	await settle(delivery, result, now, lease);
}

/** Attempts the deliveries that are due. Returns how many it tried. */
export async function processDueDeliveries(
	options: WorkerOptions = {},
): Promise<number> {
	const now = options.now ?? new Date();
	const due = await db.webhookDelivery.findMany({
		where: { status: "PENDING", nextAttemptAt: { lte: now } },
		orderBy: { nextAttemptAt: "asc" },
		take: ATTEMPT_BATCH,
		include: { webhook: true, event: true },
	});
	if (due.length === 0) return 0;
	const allowPrivate = await allowPrivateTargets(options);
	let tried = 0;
	for (let i = 0; i < due.length; i += PARALLEL) {
		await Promise.all(
			due.slice(i, i + PARALLEL).map(async (delivery) => {
				const lease = await claim(delivery, now);
				if (!lease) return;
				tried += 1;
				try {
					await attempt(delivery, { ...options, allowPrivate, now }, lease);
				} catch (error) {
					// Count it as a failed attempt, so a delivery that always throws
					// runs out of retries instead of being picked up forever.
					console.error(`Webhook delivery ${delivery.id} failed:`, error);
					await settle(
						delivery,
						{ ok: false, error: "internal_error", statusCode: null },
						now,
						lease,
					).catch(() => undefined);
				}
			}),
		);
	}
	return tried;
}

let lastPrune = 0;

/** Deletes finished deliveries and delivered events past retention. */
export async function pruneWebhookData(now = new Date()): Promise<void> {
	const before = new Date(now.getTime() - RETENTION_DAYS * DAY_MS);
	await db.webhookDelivery.deleteMany({
		where: { status: { not: "PENDING" }, createdAt: { lt: before } },
	});
	await db.apiEvent.deleteMany({
		where: {
			createdAt: { lt: before },
			fannedOutAt: { not: null },
			deliveries: { none: { status: "PENDING" } },
		},
	});
}

export async function runWebhookWorker(
	options: WorkerOptions = {},
): Promise<{ fannedOut: number; attempted: number }> {
	let fannedOut = 0;
	// A full batch means more is waiting.
	for (let n = FAN_OUT_BATCH; n === FAN_OUT_BATCH; ) {
		n = await fanOutEvents();
		fannedOut += n;
	}
	const attempted = await processDueDeliveries(options);
	const now = options.now ?? new Date();
	if (now.getTime() - lastPrune > 60 * 60 * 1000) {
		lastPrune = now.getTime();
		await pruneWebhookData(now);
	}
	return { fannedOut, attempted };
}

type WorkerState = {
	running: boolean;
	again: boolean;
	timer?: NodeJS.Timeout;
	loop?: NodeJS.Timeout;
};

// One per server process, shared by Next's separately bundled route modules.
const globalState = globalThis as unknown as {
	retrospendWebhookWorker?: WorkerState;
};

function state(): WorkerState {
	globalState.retrospendWebhookWorker ??= { running: false, again: false };
	return globalState.retrospendWebhookWorker;
}

/**
 * Wakes at the next time there is something to do: soon, while events
 * remain that the horizon has not released; else at the next retry time.
 */
async function scheduleNext(): Promise<void> {
	const s = state();
	if (s.timer) clearTimeout(s.timer);
	const [held, next] = await Promise.all([
		db.apiEvent.findFirst({
			where: { fannedOutAt: null },
			select: { id: true },
		}),
		db.webhookDelivery.findFirst({
			where: { status: "PENDING", nextAttemptAt: { not: null } },
			orderBy: { nextAttemptAt: "asc" },
			select: { nextAttemptAt: true },
		}),
	]);
	let wait: number | null = null;
	if (held) wait = HORIZON_RETRY_MS;
	if (next?.nextAttemptAt)
		wait = Math.min(
			wait ?? Number.POSITIVE_INFINITY,
			Math.max(1000, next.nextAttemptAt.getTime() - Date.now()),
		);
	if (wait === null) return;
	s.timer = setTimeout(kickWebhookDeliveries, Math.min(wait, 2 ** 30));
	s.timer.unref();
}

/**
 * Runs a sweep in the background, soon. Calls while one is running fold
 * into one more sweep. Never throws. Off under test, where the tests call
 * `runWebhookWorker` themselves.
 */
export function kickWebhookDeliveries(): void {
	if (env.NODE_ENV === "test") return;
	const s = state();
	if (s.running) {
		s.again = true;
		return;
	}
	s.running = true;
	setImmediate(async () => {
		try {
			do {
				s.again = false;
				await runWebhookWorker();
			} while (s.again);
		} catch (error) {
			console.error("Webhook worker failed:", error);
		}
		await scheduleNext().catch((error) =>
			console.error("Webhook worker could not schedule:", error),
		);
		s.running = false;
	});
}

/**
 * Starts the fallback loop (a sweep now, then every minute) once per
 * process. Called at boot from instrumentation.ts.
 */
export function startWebhookWorker(): void {
	if (env.NODE_ENV === "test") return;
	const s = state();
	if (s.loop) return;
	s.loop = setInterval(kickWebhookDeliveries, SWEEP_EVERY_MS);
	s.loop.unref();
	kickWebhookDeliveries();
}
