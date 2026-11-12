/**
 * What the admin page says about recurring auto-post. The server decides the
 * state from the `recurring_auto_post` status row (written by every sweep,
 * recurring-auto-post.ts) and the switch; the page only draws it.
 */
import { z } from "zod";
import {
	AUTO_POST_STATUS_KEY,
	type AutoPostOffReason,
	autoPostOffReason,
} from "./recurring-auto-post";

/** The sweep runs every 15 minutes. */
const SWEEP_MS = 15 * 60 * 1000;

/**
 * Three sweeps without a row update. One missed pass is a restart or a slow
 * catch-up, and a pass that posts 31 periods for many templates can run for
 * minutes, so two intervals would flap; three means the timer is not running.
 */
export const AUTO_POST_STALE_MS = 3 * SWEEP_MS;

export type AutoPostState =
	| "healthy"
	| "attention"
	| "failing"
	| "stale"
	| "off";

export interface AutoPostStatus {
	state: AutoPostState;
	/** Why it is off, null unless the state is off. */
	offReason: AutoPostOffReason | null;
	/** ISO time of the last pass, null when there is no readable row. */
	lastRun: string | null;
	/** The last pass's counts, null when there is no readable row. */
	counts: {
		posted: number;
		missingRate: number;
		capped: number;
		failed: number;
	} | null;
}

const count = z.number().int().nonnegative();
const rowSchema = z.object({
	lastRun: z.string().refine((s) => !Number.isNaN(Date.parse(s))),
	posted: count,
	missingRate: count,
	capped: count,
	failed: count,
});

/**
 * Off when `offReason` is set (the setting says false, or it is unset outside
 * production). Stale when the last pass is older than
 * AUTO_POST_STALE_MS, or there is no readable row while it is on (the first
 * pass runs at start, so none means the timer never ran). Then, from the last
 * pass: failing when a template failed, attention when a template skipped
 * for a missing rate (the person adds the rate) or still had periods due
 * after the per-pass cap (it catches up on the next pass); nothing is broken
 * in either case. Else healthy. `retry` and `raced` are normal and never
 * change the state.
 */
export function autoPostStatus(
	row: unknown,
	offReason: AutoPostOffReason | null,
	now: Date,
): AutoPostStatus {
	const parsed = rowSchema.safeParse(row);
	const data = parsed.success ? parsed.data : null;
	const base: Pick<AutoPostStatus, "lastRun" | "counts"> = data
		? {
				lastRun: new Date(data.lastRun).toISOString(),
				counts: {
					posted: data.posted,
					missingRate: data.missingRate,
					capped: data.capped,
					failed: data.failed,
				},
			}
		: { lastRun: null, counts: null };
	const on = { offReason: null, ...base };
	if (offReason) return { state: "off", ...base, offReason };
	if (!data || now.getTime() - Date.parse(data.lastRun) > AUTO_POST_STALE_MS)
		return { state: "stale", ...on };
	if (data.failed > 0) return { state: "failing", ...on };
	if (data.missingRate > 0 || data.capped > 0)
		return { state: "attention", ...on };
	return { state: "healthy", ...on };
}

interface StatusReader {
	systemStatus: {
		findUnique(args: {
			where: { key: string };
		}): Promise<{ value: unknown } | null>;
	};
}

export async function readAutoPostStatus(
	db: StatusReader,
	now = new Date(),
	offReason = autoPostOffReason(),
): Promise<AutoPostStatus> {
	const row = await db.systemStatus.findUnique({
		where: { key: AUTO_POST_STATUS_KEY },
	});
	return autoPostStatus(row?.value, offReason, now);
}
