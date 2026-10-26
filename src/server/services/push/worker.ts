import { env } from "~/env";
import { db } from "~/server/db";
import { getAppSettings } from "~/server/services/settings";
import { capHostOf, runWithLimits } from "~/server/services/webhooks/pool";
import type { Resolver } from "~/server/services/webhooks/ssrf";
import type { PushDelivery, PushTransport } from "~prisma";
import { enabledTransports, type PushConfig, pushConfig } from "./config";
import { isDeviceUsable } from "./enqueue";
import { FAN_OUT_BATCH, fanOutPushEvents, STALE_MS } from "./fanout";
import { PUSH_KINDS } from "./kinds";
import { buildPushMessage, PUSH_TTL_SECONDS, parsePushData } from "./message";
import { raiseRecurringDue } from "./recurring";
import {
	CLAIM_LEASE_MS,
	isUnreachable,
	PARALLEL_ATTEMPTS,
	PER_HOST_ATTEMPTS,
	PER_USER_ATTEMPTS,
	PER_USER_BATCH,
	RETENTION_DAYS,
	retryDelayMs,
	UNREACHABLE_CIRCUIT_FAILURES,
	UNREACHABLE_CIRCUIT_WINDOW_MS,
	UNREACHABLE_MAX_ATTEMPTS,
} from "./schedule";
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
const DAY_MS = 86_400_000;
const HORIZON_RETRY_MS = 2000;
const SWEEP_EVERY_MS = 60_000;
const RECURRING_EVERY_MS = 5 * 60_000;

type Due = PushDelivery;

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
	transport: PushTransport | undefined,
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
	// An endpoint a user chose that nothing answers is not worth the full
	// run of retries (see the caps in schedule.ts).
	const unreachable =
		outcome.kind === "retry" &&
		outcome.statusCode === null &&
		transport === "UNIFIEDPUSH" &&
		isUnreachable(outcome.code);
	const wait =
		outcome.kind !== "retry" ||
		(unreachable && attempts >= UNREACHABLE_MAX_ATTEMPTS)
			? null
			: retryDelayMs(attempts, outcome.retryAfterMs);
	await db.pushDelivery.updateMany({
		where: owned,
		data: {
			...base,
			status: wait === null ? "FAILED" : "PENDING",
			nextAttemptAt: wait === null ? null : new Date(now.getTime() + wait),
			lastStatusCode: outcome.statusCode,
			lastError: wait === null && unreachable ? "unreachable" : outcome.code,
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
	// Read the device again, on every attempt and so on every retry: it may
	// have been deleted, re-registered with a new address, handed to another
	// account, or belong to someone who has since been deactivated, in the
	// minutes or hours since the push was queued.
	const device = await db.pushDevice.findUnique({
		where: { id: delivery.deviceId },
		include: { user: { select: { language: true, isActive: true } } },
	});
	// A deleted device takes its deliveries with it, so there is nothing to settle.
	if (!device) return;
	if (!device.user.isActive)
		return failWithout(delivery, lease, "user_inactive");
	// Session or key lapsed, or the address now belongs to a newer account.
	if (!(await isDeviceUsable(db, device, now)))
		return failWithout(delivery, lease, "device_unusable");
	const sender = senders[device.transport];
	if (!sender) return failWithout(delivery, lease, "no_sender");
	const data = parsePushData(delivery.payload);
	if (!data) return failWithout(delivery, lease, "bad_payload");
	// The person may have switched this type off since the push was queued.
	const muted = await db.notificationPreference.findFirst({
		where: {
			userId: device.userId,
			type: PUSH_KINDS[data.type].preference,
			push: false,
		},
		select: { id: true },
	});
	if (muted) return failWithout(delivery, lease, "push_off");
	if (now.getTime() - delivery.createdAt.getTime() > PUSH_TTL_SECONDS * 1000)
		return failWithout(delivery, lease, "expired");
	if (device.transport === "UNIFIEDPUSH" && (await circuitOpen(device.id, now)))
		return failWithout(delivery, lease, "device_unreachable");
	const message = await buildPushMessage(data, device.user.language);
	const outcome = await sender.send(device, message);
	await settle(delivery, device.transport, outcome, now, lease);
}

/**
 * Whether this endpoint has failed to answer too often lately to be worth
 * another try. The window slides, so an hour after the last drops one push
 * goes out and finds out whether the endpoint is back.
 */
async function circuitOpen(deviceId: string, now: Date): Promise<boolean> {
	const drops = await db.pushDelivery.count({
		where: {
			deviceId,
			status: "FAILED",
			lastError: "unreachable",
			lastAttemptAt: {
				gt: new Date(now.getTime() - UNREACHABLE_CIRCUIT_WINDOW_MS),
			},
		},
	});
	return drops >= UNREACHABLE_CIRCUIT_FAILURES;
}

/**
 * The due deliveries to work on now: at most PER_USER_BATCH per account,
 * oldest first, interleaved across accounts (everyone's oldest, then
 * everyone's second oldest). Plain "oldest first" would let one account with
 * a backlog fill the batch for as long as the backlog lasts.
 */
async function pickDue(now: Date): Promise<Due[]> {
	const picked = await db.$queryRaw<{ id: string }[]>`
		SELECT "id" FROM (
			SELECT "id", "nextAttemptAt",
				row_number() OVER (PARTITION BY "userId" ORDER BY "nextAttemptAt", "id") AS "rank"
			FROM "push_delivery"
			WHERE "status" = 'PENDING' AND "nextAttemptAt" <= ${now}
		) due
		WHERE "rank" <= ${PER_USER_BATCH}
		ORDER BY "rank", "nextAttemptAt", "id"
		LIMIT ${ATTEMPT_BATCH}`;
	if (picked.length === 0) return [];
	const rows = await db.pushDelivery.findMany({
		where: { id: { in: picked.map((p) => p.id) } },
	});
	const byId = new Map(rows.map((r) => [r.id, r]));
	return picked.flatMap((p) => byId.get(p.id) ?? []);
}

/** Batches one call to processDuePushes works through before it stops. */
const MAX_ROUNDS = 20;

/**
 * Sends the deliveries that are due. Returns how many it tried. A batch
 * holds a few deliveries per account, so the call takes batch after batch
 * until nothing is due: a person with a long queue is served in turns with
 * everyone else instead of all at once.
 */
export async function processDuePushes(
	options: PushWorkerOptions = {},
): Promise<number> {
	let total = 0;
	for (let round = 0; round < MAX_ROUNDS; round++) {
		const tried = await processBatch(options);
		total += tried;
		if (tried === 0) break;
	}
	return total;
}

async function processBatch(options: PushWorkerOptions): Promise<number> {
	const now = options.now ?? new Date();
	const config = options.config ?? pushConfig();
	const due = await pickDue(now);
	if (due.length === 0) return 0;
	const devices = new Map(
		(
			await db.pushDevice.findMany({
				where: { id: { in: [...new Set(due.map((d) => d.deviceId))] } },
				select: { id: true, transport: true, endpoint: true },
			})
		).map((d) => [d.id, d]),
	);

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
		await runWithLimits(
			due,
			(delivery) => {
				const device = devices.get(delivery.deviceId);
				return {
					user: delivery.userId,
					host:
						device?.transport === "UNIFIEDPUSH"
							? capHostOf(device.endpoint)
							: null,
				};
			},
			{
				total: PARALLEL_ATTEMPTS,
				perUser: PER_USER_ATTEMPTS,
				perHost: PER_HOST_ATTEMPTS,
			},
			async (delivery) => {
				// A fresh time per claim: a batch can take a while, and a lease
				// measured from the start of the sweep would already be short
				// (or over) for the later deliveries, letting another instance
				// take them while they are still being sent.
				const at = options.now ?? new Date();
				const lease = await claim(delivery, at);
				if (!lease) return;
				tried += 1;
				try {
					await attempt(delivery, senders, at, lease);
				} catch (error) {
					// Count it as a failed attempt, so a delivery that always
					// throws runs out of retries instead of looping forever.
					console.error(`Push delivery ${delivery.id} failed:`, error);
					await settle(
						delivery,
						devices.get(delivery.deviceId)?.transport,
						{ kind: "retry", statusCode: null, code: "internal_error" },
						at,
						lease,
					).catch(() => undefined);
				}
			},
		);
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
