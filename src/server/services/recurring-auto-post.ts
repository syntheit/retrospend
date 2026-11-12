/**
 * Recurring auto-post (E2EE D11 PR 6, docs/roadmap/e2ee-d11-pr6.md): every
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
 *   due date with that day's rate, up to CATCH_UP_CAP per pass.
 * - Nothing advances on a failure (a missing rate, a key), so the next pass
 *   retries; Needs you shows it as overdue after an hour (needs-you/activity.ts).
 */
import { MissingRateError } from "@retrospend/domain/money";
import { TRPCError } from "@trpc/server";
import { env } from "~/env";
import { textUnavailableProblem } from "~/server/crypto/field-open";
import { db } from "~/server/db";
import { ensureUserKeyringWhenSealing } from "~/server/services/keys/data-key.service";
import { forUser } from "~/server/services/preview";
import type { Prisma } from "~prisma";
import { confirmRecurringExpense } from "./recurring-confirm.mutation";

const EVERY_MS = 15 * 60 * 1000;

/** Periods one template posts in one pass; a template years behind continues next pass. */
export const CATCH_UP_CAP = 31;

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
		SELECT "id", "userId", "nextDueDate"
		FROM "recurring_template"
		WHERE "isActive" AND "autoPay" AND "amountMode" = 'FIXED'
			AND "nextDueDate" <= ${now}
		ORDER BY "nextDueDate", "id"`;
}

/** What is safe to log about an error: its code or name, never its message (it can carry row values). */
const errorCode = (error: unknown) => {
	const code = (error as { code?: unknown } | null)?.code;
	if (typeof code === "string") return code;
	return error instanceof Error ? error.name : "unknown";
};

function outcomeOf(error: unknown): Outcome {
	if (
		error instanceof TRPCError &&
		(error.code === "CONFLICT" || error.code === "NOT_FOUND")
	)
		return "raced";
	if (error instanceof MissingRateError) return "missingRate";
	if (textUnavailableProblem(error) === "key_rotated") return "retry";
	console.error(
		"Recurring auto-post failed for one template:",
		errorCode(error),
	);
	return "failed";
}

/** Posts one period; the template's next due date when it posted. */
async function postOne(
	c: Candidate,
): Promise<{ outcome: Outcome; nextDueAt?: Date }> {
	try {
		const { value } = await forUser(c.userId).apply(confirmRecurringExpense, {
			templateId: c.id,
			dueDate: c.nextDueDate,
			auto: true,
		});
		return { outcome: "posted", nextDueAt: value.nextDueAt };
	} catch (error) {
		return { outcome: outcomeOf(error) };
	}
}

/** Every due period of one template, oldest first, each in its own transaction. */
async function postTemplate(
	c: Candidate,
	now: Date,
	counts: Record<keyof RecurringAutoPostResult, number>,
) {
	let due = c.nextDueDate;
	for (let i = 0; i < CATCH_UP_CAP; i++) {
		const { outcome, nextDueAt } = await postOne({ ...c, nextDueDate: due });
		counts[outcome] += 1;
		if (!nextDueAt || nextDueAt > now) return;
		due = nextDueAt;
	}
	counts.capped += 1;
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

/** RECURRING_AUTO_POST, or when unset, on in production only. */
export function autoPostEnabled(
	setting = env.RECURRING_AUTO_POST,
	nodeEnv = env.NODE_ENV,
): boolean {
	return setting ? setting === "true" : nodeEnv === "production";
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
