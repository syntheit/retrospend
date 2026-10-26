import { db } from "~/server/db";
import type { PushDelivery } from "~prisma";
import {
	PER_USER_BATCH,
	UNREACHABLE_CIRCUIT_FAILURES,
	UNREACHABLE_CIRCUIT_WINDOW_MS,
} from "./schedule";

type Due = PushDelivery;

/** How many due deliveries one pull returns at most. */
const ATTEMPT_BATCH = 200;

/**
 * Whether this endpoint has failed to answer too often lately to be worth
 * another try. The window slides, so an hour after the last drops one push
 * goes out and finds out whether the endpoint is back.
 */
export async function circuitOpen(
	deviceId: string,
	now: Date,
): Promise<boolean> {
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
export async function pickDue(now: Date): Promise<Due[]> {
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
