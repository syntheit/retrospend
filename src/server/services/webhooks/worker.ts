import { env } from "~/env";
import { FieldCryptoError } from "~/server/crypto/field-crypto";
import { textUnavailableProblem } from "~/server/crypto/field-open";
import { db } from "~/server/db";
import { getAppSettings } from "~/server/services/settings";
import type { Prisma, WebhookDelivery } from "~prisma";
import { type DeliveryOptions, deliverOnce, eventBody } from "./deliver";
import { FAN_OUT_BATCH, fanOutEvents } from "./fanout";
import { capHostOf, runWithLimits } from "./pool";
import {
	AUTO_DISABLE_AFTER,
	CLAIM_LEASE_MS,
	PARALLEL_ATTEMPTS,
	PER_HOST_ATTEMPTS,
	PER_USER_ATTEMPTS,
	PER_USER_BATCH,
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
 *
 * A webhook's url is sealed with the instance key once sealing is on (D11),
 * and this worker reads it on the global client, which opens instance cells.
 * `pickDue` opens each url once and hands it on with its host, so nothing
 * opens a url twice. A url that cannot be opened (a damaged cell, or a key
 * that is not available) fails only its own deliveries, as `url_unreadable`,
 * which retries and counts like `secret_unreadable`.
 */

export type WorkerOptions = {
	now?: Date;
	allowPrivate?: boolean;
	resolve?: Resolver;
	timeoutMs?: number;
	/** How long a sweep may start new attempts (milliseconds). */
	budgetMs?: number;
	/** Runs before each pull of due work, so new events are fanned out mid-sweep. */
	beforePick?: () => Promise<void>;
	/** Replaces the fan-out (tests). */
	fanOut?: () => Promise<number>;
};

const ATTEMPT_BATCH = 200;
/**
 * A sweep stops starting attempts after this long. What is running (at most
 * ten seconds each) still finishes, and the next sweep takes the rest, so
 * one person's black-hole URLs delay everyone by seconds, never minutes.
 */
const SWEEP_BUDGET_MS = 15_000;
const DAY_MS = 86_400_000;
/** Wake-up while the horizon holds events back. */
const HORIZON_RETRY_MS = 2000;
const SWEEP_EVERY_MS = 60_000;

async function allowPrivateTargets(options: WorkerOptions): Promise<boolean> {
	if (options.allowPrivate !== undefined) return options.allowPrivate;
	return (await getAppSettings()).webhooksAllowPrivateTargets;
}

/**
 * The host bucket of a delivery whose url could not be read. Settling one
 * costs no network time, so the shared per-host cap is only a bound.
 */
const UNREADABLE_HOST = "unreadable";

/**
 * The webhook's own name and url stay unread here: the name is not needed
 * to send, and the url is opened on its own so that one cell that cannot be
 * opened does not hide every other delivery of the batch.
 */
type DueRow = Prisma.WebhookDeliveryGetPayload<{
	include: { webhook: { omit: { name: true; url: true } }; event: true };
}>;

/** What `pickDue` read from the url: the address and its cap host, or the failure. */
type OpenedUrl =
	| { url: string; host: string | null; urlError?: false }
	| { url: null; host: typeof UNREADABLE_HOST; urlError: true };

export type DueDelivery = DueRow & OpenedUrl;

/**
 * Takes a delivery for this worker by moving its next attempt to a lease
 * time. Returns the lease, which the settle step must still find in place
 * (so a worker that was slow past its lease cannot overwrite the worker
 * that took over), or null when another worker got there first.
 */
export async function claim(
	delivery: Pick<WebhookDelivery, "id" | "nextAttemptAt">,
	now: Date,
): Promise<Date | null> {
	const lease = new Date(now.getTime() + CLAIM_LEASE_MS);
	const { count } = await db.webhookDelivery.updateMany({
		where: {
			id: delivery.id,
			status: "PENDING",
			// Still the value that was read, and still due: a row another worker
			// claimed since (its lease is in the future) or settled as a retry
			// (its backoff has not ended) is not ours to take.
			nextAttemptAt: { equals: delivery.nextAttemptAt, lte: now },
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
			select: { enabled: true, consecutiveFailures: true },
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
		select: { id: true },
	});
	// Its pending deliveries are left alone: one may be on the wire under
	// another worker's lease, and must still settle as sent. The rest fail
	// in attempt() when due, or go out if the webhook is back on by then.
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
				select: { id: true },
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
	if (delivery.urlError) {
		// Nothing can be sent: the address is sealed and cannot be opened. It
		// retries like any failed attempt, since a key outage is temporary.
		await settle(
			delivery,
			{ ok: false, error: "url_unreadable", statusCode: null },
			now,
			lease,
		);
		return;
	}
	const result = await deliverOnce(
		{ ...delivery.webhook, url: delivery.url },
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

/**
 * The due deliveries to work on now: at most PER_USER_BATCH per account,
 * oldest first, interleaved across accounts (everyone's oldest, then
 * everyone's second oldest). Plain "oldest first" would let one account with
 * a backlog fill the batch for as long as the backlog lasts.
 */
export async function pickDue(now: Date): Promise<DueDelivery[]> {
	const picked = await db.$queryRaw<{ id: string }[]>`
		SELECT "id" FROM (
			SELECT "id", "nextAttemptAt",
				row_number() OVER (PARTITION BY "userId" ORDER BY "nextAttemptAt", "id") AS "rank"
			FROM "webhook_delivery"
			WHERE "status" = 'PENDING' AND "nextAttemptAt" <= ${now}
		) due
		WHERE "rank" <= ${PER_USER_BATCH}
		ORDER BY "rank", "nextAttemptAt", "id"
		LIMIT ${ATTEMPT_BATCH}`;
	if (picked.length === 0) return [];
	const rows = await db.webhookDelivery.findMany({
		where: { id: { in: picked.map((p) => p.id) } },
		include: { webhook: { omit: { name: true, url: true } }, event: true },
	});
	const byId = new Map(rows.map((r) => [r.id, r]));
	const urls = await openUrls([...new Set(rows.map((r) => r.webhookId))]);
	return picked.flatMap((p): DueDelivery[] => {
		const row = byId.get(p.id);
		// A webhook deleted since the read takes its deliveries with it.
		if (!row || !urls.has(row.webhookId)) return [];
		const url = urls.get(row.webhookId) ?? null;
		return [
			url === null
				? { ...row, url, host: UNREADABLE_HOST, urlError: true }
				: { ...row, url, host: capHostOf(url) },
		];
	});
}

const cannotOpen = (error: unknown): boolean =>
	error instanceof FieldCryptoError || textUnavailableProblem(error) !== null;

/**
 * The url of each webhook, opened on the global client, or null for one that
 * cannot be opened (a damaged cell, a key that is not available). A batch
 * that fails for such a cell is read again one webhook at a time, so only the
 * deliveries of that webhook fail; any other error is not about a url and
 * ends the pull.
 */
async function openUrls(ids: string[]): Promise<Map<string, string | null>> {
	try {
		const rows = await db.webhook.findMany({
			where: { id: { in: ids } },
			select: { id: true, url: true },
		});
		return new Map(rows.map((r) => [r.id, r.url]));
	} catch (error) {
		if (!cannotOpen(error)) throw error;
	}
	const urls = new Map<string, string | null>();
	for (const id of ids) {
		try {
			const row = await db.webhook.findUnique({
				where: { id },
				select: { url: true },
			});
			if (row) urls.set(id, row.url);
		} catch (error) {
			if (!cannotOpen(error)) throw error;
			urls.set(id, null);
		}
	}
	return urls;
}

/**
 * Attempts the deliveries that are due, for at most the sweep budget.
 * Returns how many it tried. The pool pulls more work whenever slots are
 * free and nothing it holds can use them (a batch holds a few deliveries
 * per account), so a person with a long or slow queue is served in turns
 * with everyone else and never makes the rest wait for the end of a batch.
 */
export async function processDueDeliveries(
	options: WorkerOptions = {},
): Promise<number> {
	let allowPrivate: Promise<boolean> | undefined;
	let tried = 0;
	await runWithLimits<DueDelivery>(
		[],
		(delivery) => ({
			user: delivery.userId,
			host: delivery.host,
		}),
		{
			total: PARALLEL_ATTEMPTS,
			perUser: PER_USER_ATTEMPTS,
			perHost: PER_HOST_ATTEMPTS,
		},
		async (delivery) => {
			// A fresh time per claim: a sweep can take a while, and a lease
			// measured from its start would already be short (or over) for the
			// later deliveries.
			const now = options.now ?? new Date();
			const lease = await claim(delivery, now);
			if (!lease) return;
			tried += 1;
			try {
				allowPrivate ??= allowPrivateTargets(options);
				await attempt(
					delivery,
					{ ...options, allowPrivate: await allowPrivate, now },
					lease,
				);
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
		},
		{
			keyOf: (delivery) => delivery.id,
			deadline: Date.now() + (options.budgetMs ?? SWEEP_BUDGET_MS),
			refill: async () => {
				await options.beforePick?.();
				return pickDue(options.now ?? new Date());
			},
		},
	);
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

/**
 * Fans out until a batch comes back short. A failure is logged and ends the
 * fan-out for now: the events stay queued and the next sweep tries again, and
 * deliveries already due are still sent.
 */
async function fanOutAll(
	fanOut: () => Promise<number>,
	counted: { fannedOut: number },
): Promise<void> {
	try {
		// A full batch means more is waiting.
		for (let n = FAN_OUT_BATCH; n === FAN_OUT_BATCH; ) {
			n = await fanOut();
			counted.fannedOut += n;
		}
	} catch (error) {
		console.error("Webhook fan-out failed:", error);
	}
}

export async function runWebhookWorker(
	options: WorkerOptions = {},
): Promise<{ fannedOut: number; attempted: number }> {
	const counted = { fannedOut: 0 };
	const fanOut = options.fanOut ?? fanOutEvents;
	await fanOutAll(fanOut, counted);
	const attempted = await processDueDeliveries({
		...options,
		// Events written while the sweep runs are fanned out before its next pull.
		beforePick: () => fanOutAll(fanOut, counted),
	});
	const fannedOut = counted.fannedOut;
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

export { fanOutEvents, matchesEventFilter } from "./fanout";
