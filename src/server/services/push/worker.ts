import { env } from "~/env";
import { db } from "~/server/db";
import { getAppSettings } from "~/server/services/settings";
import type { Resolver } from "~/server/services/webhooks/ssrf";
import type { Prisma, PushTransport } from "~prisma";
import { enabledTransports, type PushConfig, pushConfig } from "./config";
import { FAN_OUT_BATCH, fanOutPushEvents, STALE_MS } from "./fanout";
import { buildPushMessage, PUSH_TTL_SECONDS, parsePushData } from "./message";
import { raiseRecurringDue } from "./recurring";
import { CLAIM_LEASE_MS, RETENTION_DAYS, retryDelayMs } from "./schedule";
import { createSenders, type PushSender, type SendOutcome } from "./senders";

/**
 * The push worker. It runs the way the webhook worker does (in the web
 * process, woken after a commit, re-armed by a timer, one sweep at boot and
 * then every minute) and does four things, each safe to run from several
 * processes at once:
 * 1. fans new outbox events out into one delivery per recipient device;
 * 2. raises recurring items that fell due;
 * 3. sends the deliveries that are due, claiming each first;
 * 4. prunes what is past retention.
 *
 * With no sender configured it does nothing at all, and the outbox is left
 * alone. Delivery is at least once: a crash between a send and its record
 * sends again, which a phone shows as a repeated notification at worst.
 */

export type PushWorkerOptions = {
	now?: Date;
	config?: PushConfig;
	/** Replaces the real senders (tests). */
	senders?: Partial<Record<PushTransport, PushSender>>;
	allowPrivate?: boolean;
	resolve?: Resolver;
	timeoutMs?: number;
	/** Also raise recurring items that fell due. */
	recurring?: boolean;
};

const ATTEMPT_BATCH = 50;
const PARALLEL = 5;
const DAY_MS = 86_400_000;
const HORIZON_RETRY_MS = 2000;
const SWEEP_EVERY_MS = 60_000;
const RECURRING_EVERY_MS = 5 * 60_000;

type Due = Prisma.PushDeliveryGetPayload<{
	include: { device: { include: { user: { select: { language: true } } } } };
}>;

/**
 * Takes a delivery for this worker by moving its next attempt to a lease
 * time. Returns the lease, which the settle step must still find in place,
 * or null when another worker got there first.
 */
async function claim(delivery: Due, now: Date): Promise<Date | null> {
	const lease = new Date(now.getTime() + CLAIM_LEASE_MS);
	const { count } = await db.pushDelivery.updateMany({
		where: {
			id: delivery.id,
			status: "PENDING",
			nextAttemptAt: delivery.nextAttemptAt,
		},
		data: { nextAttemptAt: lease },
	});
	return count === 1 ? lease : null;
}

async function settle(
	delivery: Due,
	outcome: SendOutcome,
	now: Date,
	lease: Date,
): Promise<void> {
	const attempts = delivery.attempts + 1;
	const owned = {
		id: delivery.id,
		status: "PENDING" as const,
		nextAttemptAt: lease,
	};
	const base = { attempts, lastAttemptAt: now };
	if (outcome.kind === "sent") {
		await db.pushDelivery.updateMany({
			where: owned,
			data: {
				...base,
				status: "SENT",
				nextAttemptAt: null,
				lastStatusCode: outcome.statusCode,
				lastError: null,
				sentAt: now,
			},
		});
		return;
	}
	if (outcome.kind === "dead") {
		// The address is gone for good (uninstalled, revoked): forget the
		// device, which also drops its pending pushes.
		await db.pushDevice.deleteMany({ where: { id: delivery.deviceId } });
		return;
	}
	const wait =
		outcome.kind === "retry"
			? retryDelayMs(attempts, outcome.retryAfterMs)
			: null;
	await db.pushDelivery.updateMany({
		where: owned,
		data: {
			...base,
			status: wait === null ? "FAILED" : "PENDING",
			nextAttemptAt: wait === null ? null : new Date(now.getTime() + wait),
			lastStatusCode: outcome.statusCode,
			lastError: outcome.code,
		},
	});
}

async function failWithout(
	delivery: Due,
	lease: Date,
	reason: string,
): Promise<void> {
	await db.pushDelivery.updateMany({
		where: { id: delivery.id, status: "PENDING", nextAttemptAt: lease },
		data: { status: "FAILED", nextAttemptAt: null, lastError: reason },
	});
}

async function attempt(
	delivery: Due,
	senders: Partial<Record<PushTransport, PushSender>>,
	now: Date,
	lease: Date,
): Promise<void> {
	const sender = senders[delivery.device.transport];
	if (!sender) return failWithout(delivery, lease, "no_sender");
	const data = parsePushData(delivery.payload);
	if (!data) return failWithout(delivery, lease, "bad_payload");
	if (now.getTime() - delivery.createdAt.getTime() > PUSH_TTL_SECONDS * 1000)
		return failWithout(delivery, lease, "expired");
	const message = await buildPushMessage(data, delivery.device.user.language);
	const outcome = await sender.send(delivery.device, message);
	await settle(delivery, outcome, now, lease);
}

/** Sends the deliveries that are due. Returns how many it tried. */
export async function processDuePushes(
	options: PushWorkerOptions = {},
): Promise<number> {
	const now = options.now ?? new Date();
	const config = options.config ?? pushConfig();
	const due = await db.pushDelivery.findMany({
		where: { status: "PENDING", nextAttemptAt: { lte: now } },
		orderBy: { nextAttemptAt: "asc" },
		take: ATTEMPT_BATCH,
		include: {
			device: { include: { user: { select: { language: true } } } },
		},
	});
	if (due.length === 0) return 0;

	const senders =
		options.senders ??
		createSenders(config, {
			timeoutMs: options.timeoutMs,
			webPush: {
				allowHosts: config.allowHosts,
				resolve: options.resolve,
				allowPrivateTargets: async () =>
					options.allowPrivate ??
					(await getAppSettings()).webhooksAllowPrivateTargets,
			},
		});
	let tried = 0;
	try {
		for (let i = 0; i < due.length; i += PARALLEL) {
			await Promise.all(
				due.slice(i, i + PARALLEL).map(async (delivery) => {
					const lease = await claim(delivery, now);
					if (!lease) return;
					tried += 1;
					try {
						await attempt(delivery, senders, now, lease);
					} catch (error) {
						// Count it as a failed attempt, so a delivery that always
						// throws runs out of retries instead of looping forever.
						console.error(`Push delivery ${delivery.id} failed:`, error);
						await settle(
							delivery,
							{ kind: "retry", statusCode: null, code: "internal_error" },
							now,
							lease,
						).catch(() => undefined);
					}
				}),
			);
		}
	} finally {
		if (!options.senders)
			for (const sender of Object.values(senders)) sender.close();
	}
	return tried;
}

let lastPrune = 0;

/** Deletes finished deliveries past retention. */
export async function prunePushData(now = new Date()): Promise<void> {
	await db.pushDelivery.deleteMany({
		where: {
			status: { not: "PENDING" },
			createdAt: { lt: new Date(now.getTime() - RETENTION_DAYS * DAY_MS) },
		},
	});
}

export async function runPushWorker(
	options: PushWorkerOptions = {},
): Promise<{ fannedOut: number; attempted: number }> {
	const config = options.config ?? pushConfig();
	if (enabledTransports(config).length === 0)
		return { fannedOut: 0, attempted: 0 };
	let fannedOut = 0;
	// A full batch means more is waiting.
	for (let n = FAN_OUT_BATCH; n === FAN_OUT_BATCH; ) {
		n = await fanOutPushEvents(config, options.now);
		fannedOut += n;
	}
	if (options.recurring) await raiseRecurringDue(config, options.now);
	const attempted = await processDuePushes({ ...options, config });
	const now = options.now ?? new Date();
	if (now.getTime() - lastPrune > 60 * 60 * 1000) {
		lastPrune = now.getTime();
		await prunePushData(now);
	}
	return { fannedOut, attempted };
}

type WorkerState = {
	running: boolean;
	again: boolean;
	lastRecurring: number;
	timer?: NodeJS.Timeout;
	loop?: NodeJS.Timeout;
};

// One per server process, shared by Next's separately bundled route modules.
const globalState = globalThis as unknown as {
	retrospendPushWorker?: WorkerState;
};

function state(): WorkerState {
	globalState.retrospendPushWorker ??= {
		running: false,
		again: false,
		lastRecurring: 0,
	};
	return globalState.retrospendPushWorker;
}

/**
 * Wakes at the next time there is something to do: soon, while events
 * remain that the outbox horizon has not released; else at the next retry.
 */
async function scheduleNext(): Promise<void> {
	const s = state();
	if (s.timer) clearTimeout(s.timer);
	const [held, next] = await Promise.all([
		db.apiEvent.findFirst({
			where: {
				pushedAt: null,
				createdAt: { gt: new Date(Date.now() - STALE_MS) },
			},
			select: { id: true },
		}),
		db.pushDelivery.findFirst({
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
	s.timer = setTimeout(kickPushDeliveries, Math.min(wait, 2 ** 30));
	s.timer.unref();
}

/**
 * Runs a sweep in the background, soon. Calls while one is running fold
 * into one more sweep. Never throws. Off under test, where the tests call
 * `runPushWorker` themselves, and off when no sender is configured.
 */
export function kickPushDeliveries(): void {
	if (env.NODE_ENV === "test") return;
	if (enabledTransports(pushConfig()).length === 0) return;
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
				const recurring = Date.now() - s.lastRecurring > RECURRING_EVERY_MS;
				if (recurring) s.lastRecurring = Date.now();
				await runPushWorker({ recurring });
			} while (s.again);
		} catch (error) {
			console.error("Push worker failed:", error);
		}
		await scheduleNext().catch((error) =>
			console.error("Push worker could not schedule:", error),
		);
		s.running = false;
	});
}

/**
 * Starts the fallback loop (a sweep now, then every minute) once per
 * process. Called at boot from instrumentation.ts.
 */
export function startPushWorker(): void {
	if (env.NODE_ENV === "test") return;
	const s = state();
	if (s.loop) return;
	s.loop = setInterval(kickPushDeliveries, SWEEP_EVERY_MS);
	s.loop.unref();
	kickPushDeliveries();
}
