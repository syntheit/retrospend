import { db } from "~/server/db";

export type RateLimitDecision = {
	allowed: boolean;
	/** Requests counted in the current window, this one included. */
	count: number;
	limit: number;
	/** Whole seconds until the window resets (at least 1). */
	retryAfterSeconds: number;
};

const PRUNE_PROBABILITY = 0.01;
const PRUNE_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Counts one request against `key` in a fixed window of `windowMs` and says
 * whether it fits under `limit`. One atomic upsert in Postgres, so
 * concurrent requests and several app instances share one count and a
 * restart forgets nothing. A row whose stored window is newer than ours
 * (another instance's clock runs ahead) keeps its window and still counts
 * the request, so skew can never reset a full window.
 */
export async function consumeRateLimit(
	key: string,
	limit: number,
	windowMs: number,
	now: Date = new Date(),
): Promise<RateLimitDecision> {
	const windowStart = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
	const [row] = await db.$queryRaw<{ count: number; windowStart: Date }[]>`
		INSERT INTO "api_rate_limit" ("key", "windowStart", "count")
		VALUES (${key}, ${windowStart}, 1)
		ON CONFLICT ("key") DO UPDATE SET
			"count" = CASE
				WHEN "api_rate_limit"."windowStart" >= EXCLUDED."windowStart"
				THEN "api_rate_limit"."count" + 1
				ELSE 1
			END,
			"windowStart" = GREATEST("api_rate_limit"."windowStart", EXCLUDED."windowStart")
		RETURNING "count", "windowStart"`;
	if (Math.random() < PRUNE_PROBABILITY) {
		void pruneRateLimits(new Date(now.getTime() - PRUNE_AGE_MS)).catch(
			() => undefined,
		);
	}
	const count = Number(row?.count ?? 1);
	const resetAt = (row?.windowStart ?? windowStart).getTime() + windowMs;
	return {
		allowed: count <= limit,
		count,
		limit,
		retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now.getTime()) / 1000)),
	};
}

/** Drops counters whose window ended long ago (IP keys never come back). */
export async function pruneRateLimits(before: Date): Promise<number> {
	const { count } = await db.apiRateLimit.deleteMany({
		where: { windowStart: { lt: before } },
	});
	return count;
}
