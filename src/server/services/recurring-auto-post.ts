/**
 * Recurring auto-post: every
 * 15 minutes each due template that pays automatically with a fixed amount
 * is posted exactly as Confirm posts it, by `recurring.confirm` through the
 * preview runner as its owner. So row-level security stays on, the name is
 * sealed with the owner's key, the figures are a manual confirm's and the
 * `recurring.confirmed` event is appended in the same transaction. Only the
 * ids are read on the owner connection, as in auto-finalize.ts.
 *
 * - Idempotent without a lock: the confirm checks the due date it was given
 *   and advances the template with a compare-and-set, so two replicas, or a
 *   sweep and a tap on Confirm, book each period once.
 * - `auto: true` makes the confirm require auto-pay and a fixed amount again
 *   inside its transaction: the person may have turned either off since the
 *   ids were read.
 * - After downtime a template posts every missed period, each dated its own
 *   due date with that day's rate, up to CATCH_UP_CAP (the domain's
 *   runCatchUp) per pass.
 * - A protected account's templates never post (its personal rows live in the
 *   vault, F9): the due list leaves them out, and the state is read again
 *   before every period, so a template whose owner turns protection on
 *   mid-pass stops at once. Income templates too: the confirm writes a
 *   personal row either way.
 * - Nothing advances on a failure (a missing rate, a key), so the next pass
 *   retries; Needs you shows it as overdue after an hour (needs-you/activity.ts).
 */
import { MissingRateError } from "@retrospend/domain/money";
import {
	type CatchUpPort,
	runCatchUp,
} from "@retrospend/domain/recurring-post/plan";
import { RecurringRefusal } from "@retrospend/domain/recurring-post/refusals";
import { env } from "~/env";
import { textUnavailableProblem } from "~/server/crypto/field-open";
import { db } from "~/server/db";
import { ensureUserKeyringWhenSealing } from "~/server/services/keys/data-key.service";
import { forUser } from "~/server/services/preview";
import { isProtectedNow } from "~/server/services/protection/now";
import type { Prisma } from "~prisma";
import { confirmRecurringExpense } from "./recurring-confirm.mutation";

const EVERY_MS = 15 * 60 * 1000;

/** The `system_status` row with the last pass's counts. */
export const AUTO_POST_STATUS_KEY = "recurring_auto_post";

export interface RecurringAutoPostResult {
	readonly posted: number;
	/** Confirmed, skipped or changed by someone else first. */
	readonly raced: number;
	readonly missingRate: number;
	/** A key was being made or replaced; the next pass posts it. */
	readonly retry: number;
	/** Templates that still had periods due after CATCH_UP_CAP posts. */
	readonly capped: number;
	readonly failed: number;
}

type Outcome = Exclude<keyof RecurringAutoPostResult, "capped">;
type RawSource = Pick<Prisma.TransactionClient, "$queryRaw">;

interface Candidate {
	id: string;
	userId: string;
	nextDueDate: Date;
}

/** Due templates that post on their own. Ids and the due date only, never text. */
function dueTemplates(source: RawSource, now: Date) {
	return source.$queryRaw<Candidate[]>`
		SELECT t."id", t."userId", t."nextDueDate"
		FROM "recurring_template" t
		JOIN "user" u ON u."id" = t."userId"
		WHERE t."isActive" AND t."autoPay" AND t."amountMode" = 'FIXED'
			AND t."nextDueDate" <= ${now}
			AND u."protectionState" = 'OFF'
		ORDER BY t."nextDueDate", t."id"`;
}

/** What is safe to log about an error: its code or name, never its message (it can carry row values). */
const errorCode = (error: unknown) => {
	const code = (error as { code?: unknown } | null)?.code;
	if (typeof code === "string") return code;
	return error instanceof Error ? error.name : "unknown";
};

const logFailure = (code: string) =>
	console.error("Recurring auto-post failed for one template:", code);

function outcomeOf(error: unknown): Exclude<Outcome, "posted"> {
	// Not found, already posted or not due: someone else got there first.
	if (error instanceof RecurringRefusal) return "raced";
	if (error instanceof MissingRateError) return "missingRate";
	if (textUnavailableProblem(error) === "key_rotated") return "retry";
	logFailure(errorCode(error));
	return "failed";
}

/** The domain's catch-up loop over this server: one confirm per period, one protection read before each later one. */
function catchUpPort(c: Candidate): CatchUpPort<ReturnType<typeof outcomeOf>> {
	return {
		isProtected: () => isProtectedNow(c.userId),
		post: async ({ dueAt }) => {
			try {
				const { value } = await forUser(c.userId).apply(
					confirmRecurringExpense,
					{ templateId: c.id, dueDate: dueAt, auto: true },
				);
				return { posted: true, nextDueDate: value.nextDueAt };
			} catch (error) {
				return { posted: false, outcome: outcomeOf(error) };
			}
		},
	};
}

/**
 * Every due period of one template, oldest first, each in its own transaction.
 * A protection read that fails stops the template and is logged and counted
 * as a failure, like any other failed post; nothing advances.
 */
async function postTemplate(
	c: Candidate,
	now: Date,
	counts: Record<keyof RecurringAutoPostResult, number>,
) {
	const run = await runCatchUp(catchUpPort(c), c.nextDueDate, now);
	for (const result of run.results)
		counts[result.posted ? "posted" : result.outcome] += 1;
	if (run.stopped === "cap") counts.capped += 1;
	if (run.stopped === "protection_unreadable") {
		logFailure("protection_unreadable");
		counts.failed += 1;
	}
}

/**
 * One pass over the due templates, then the counts in the status row. There
 * is no lock across the pass (see auto-finalize.ts). A user's key is made
 * before their first post, outside any transaction: a transaction only loads
 * keys, so a new user's first sealed post would otherwise wait a pass.
 */
export async function sweepRecurringAutoPost(
	now = new Date(),
	source: RawSource = db,
): Promise<RecurringAutoPostResult> {
	const counts: Record<keyof RecurringAutoPostResult, number> = {
		posted: 0,
		raced: 0,
		missingRate: 0,
		retry: 0,
		capped: 0,
		failed: 0,
	};
	const keyed = new Set<string>();
	for (const candidate of await dueTemplates(source, now)) {
		// Before the key is made: a protected account gets none from this pass.
		if (await isProtectedNow(candidate.userId)) continue;
		try {
			if (!keyed.has(candidate.userId))
				await ensureUserKeyringWhenSealing(candidate.userId);
			keyed.add(candidate.userId);
		} catch (error) {
			counts[outcomeOf(error)] += 1;
			continue;
		}
		await postTemplate(candidate, now, counts);
	}
	const value = { lastRun: now.toISOString(), ...counts };
	await db.systemStatus.upsert({
		where: { key: AUTO_POST_STATUS_KEY },
		create: { key: AUTO_POST_STATUS_KEY, value },
		update: { value },
	});
	if (counts.posted > 0 || counts.failed > 0 || counts.capped > 0)
		console.log(
			`Recurring auto-post: ${counts.posted} posted, ${counts.raced} changed meanwhile, ${counts.missingRate} missing a rate, ${counts.retry} to retry, ${counts.capped} capped, ${counts.failed} failed`,
		);
	return counts;
}

/** Why auto-post is off: the setting says so, or it is unset outside production. Null when on. */
export type AutoPostOffReason = "setting" | "environment";

export function autoPostOffReason(
	setting = env.RECURRING_AUTO_POST,
	nodeEnv = env.NODE_ENV,
): AutoPostOffReason | null {
	if (setting) return setting === "true" ? null : "setting";
	return nodeEnv === "production" ? null : "environment";
}

/** RECURRING_AUTO_POST, or when unset, on in production only. */
export function autoPostEnabled(
	setting = env.RECURRING_AUTO_POST,
	nodeEnv = env.NODE_ENV,
): boolean {
	return autoPostOffReason(setting, nodeEnv) === null;
}

const started = Symbol.for("retrospend.recurringAutoPost");

/** Starts the 15-minute sweep once per server process, with a first pass now. */
export function startRecurringAutoPost(everyMs = EVERY_MS) {
	if (env.NODE_ENV === "test" || !autoPostEnabled()) return;
	const g = globalThis as Record<symbol, unknown>;
	if (g[started]) return;
	const run = () =>
		sweepRecurringAutoPost().catch((error) => {
			console.error("Recurring auto-post sweep failed:", errorCode(error));
		});
	const timer = setInterval(run, everyMs);
	// A pending sweep must not keep the process alive.
	timer.unref();
	g[started] = true;
	void run();
}
