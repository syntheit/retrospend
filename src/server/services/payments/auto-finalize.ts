/**
 * Auto-finalize (MONEY-MOVES §1.5): a payment the payee has not answered for
 * 7 days turns final, as if the payee had confirmed it. Balances already
 * count a pending payment for the payer; this makes it count for the payee
 * too, with the same header, split locks and audit entry a confirm writes.
 *
 * Each payment is finalized by `payment.autoFinalize` (the shared confirm
 * core) through the preview runner, as the payee, so row-level security stays
 * on, `lock_settled_splits` sees a party and the `payment.confirmed` event is
 * appended in the same transaction. Only the list of ids is read on the
 * owner connection, like the other hourly sweeps (retention-sweep.ts).
 *
 * Every payment has a header: new ones are written with it, and the legacy
 * rows got one in the backfill of 20261023200000_payments_corrections. So
 * selecting on the header covers them all, and a row with no paymentGroupId
 * is not expected to exist.
 *
 * - The payee, not the payer, is the actor and `autoConfirmedReason` stays
 *   null: the payer cannot void it, and the payee can still say "not
 *   received" through payment.unconfirm.
 * - A payment the payee reopened (an unconfirm entry exists) waits for a
 *   person from then on, so an unconfirm is not undone an hour later.
 * - A claim that would credit more than is still owed (ConfirmInsteadError)
 *   stays pending for the payee to settle by hand.
 */
import { TRPCError } from "@trpc/server";
import { env } from "~/env";
import { db } from "~/server/db";
import { forUser } from "~/server/services/preview";
import type { ParticipantType, Prisma } from "~prisma";
import { autoFinalizePayment, ReopenedError } from "./auto-finalize.mutation";
import { ConfirmInsteadError } from "./confirm.mutation";

export const AUTO_FINALIZE_AFTER_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;
const EVERY_MS = 60 * 60 * 1000;

export interface AutoFinalizeResult {
	readonly finalized: number;
	/** Left pending: confirming would credit more than is still owed. */
	readonly overClaimed: number;
	/** Changed by someone else first (a confirm, a reject, a delete). */
	readonly raced: number;
	/** Skipped: the payee reopened it once, so it waits for a person. */
	readonly reopened: number;
	readonly failed: number;
}

type Outcome = keyof AutoFinalizeResult;
type RawSource = Pick<Prisma.TransactionClient, "$queryRaw">;

interface Candidate {
	id: string;
	payerType: ParticipantType;
	payerId: string;
	payeeId: string;
}

/**
 * Pending payments to a user whose rows are all pending and at least one is
 * older than the cutoff, minus the ones the payee already reopened. Ids and
 * the two parties only.
 */
function staleCandidates(source: RawSource, cutoff: Date) {
	return source.$queryRaw<Candidate[]>`
		SELECT p."id", p."payerType"::text AS "payerType", p."payerId", p."payeeId"
		FROM "payment" p
		WHERE p."status" = 'PROPOSED'
			AND p."payeeType" = 'user'
			AND EXISTS (
				SELECT 1 FROM "settlement" s
				WHERE s."paymentGroupId" = p."id" AND s."initiatedAt" < ${cutoff}
			)
			AND NOT EXISTS (
				SELECT 1 FROM "settlement" s
				WHERE s."paymentGroupId" = p."id" AND s."status" <> 'PROPOSED'
			)
			AND NOT EXISTS (
				SELECT 1 FROM "audit_log_entry" a
				WHERE a."targetType" = 'SETTLEMENT'
					AND a."context" ->> 'action' = 'settlement_unconfirmed'
					AND a."changes" ->> 'paymentGroupId' = p."id"
			)
		ORDER BY p."createdAt", p."id"`;
}

/** What is safe to log about an error: its code or name, never its message (it can carry row values). */
const errorCode = (error: unknown) => {
	const code = (error as { code?: unknown } | null)?.code;
	if (typeof code === "string") return code;
	return error instanceof Error ? error.name : "unknown";
};

async function finalizeOne(c: Candidate): Promise<Outcome> {
	try {
		await forUser(c.payeeId).apply(autoFinalizePayment, {
			paymentId: c.id,
			person: { participantType: c.payerType, participantId: c.payerId },
		});
		return "finalized";
	} catch (error) {
		if (error instanceof ReopenedError) return "reopened";
		if (error instanceof ConfirmInsteadError) return "overClaimed";
		if (
			error instanceof TRPCError &&
			["CONFLICT", "BAD_REQUEST", "NOT_FOUND"].includes(error.code)
		)
			return "raced";
		console.error("Auto-finalize failed for one payment:", errorCode(error));
		return "failed";
	}
}

/**
 * One pass over the stale payments. There is no lock across the pass (a
 * transaction open that long would hold back every user's event feed, see
 * feed.ts): each payment takes its pair lock and checks it is still pending,
 * so two replicas, or a replica and a confirm, finalize it once.
 */
export async function sweepStalePayments(
	now = new Date(),
	source: RawSource = db,
): Promise<AutoFinalizeResult> {
	const cutoff = new Date(now.getTime() - AUTO_FINALIZE_AFTER_DAYS * DAY_MS);
	const counts: Record<Outcome, number> = {
		finalized: 0,
		overClaimed: 0,
		raced: 0,
		reopened: 0,
		failed: 0,
	};
	for (const candidate of await staleCandidates(source, cutoff)) {
		counts[await finalizeOne(candidate)] += 1;
	}
	return counts;
}

/** Finalizes every payment pending for more than 7 days. Logs one line with counts only. */
export async function finalizeStaleProposedPayments(
	now = new Date(),
): Promise<AutoFinalizeResult> {
	const result = await sweepStalePayments(now);
	// Over-claimed and reopened payments stay pending hour after hour: no line.
	if (result.finalized > 0 || result.failed > 0) {
		console.log(
			`Auto-finalize: ${result.finalized} finalized, ${result.overClaimed} left pending (over-claimed), ${result.raced} changed meanwhile, ${result.reopened} reopened, ${result.failed} failed`,
		);
	}
	return result;
}

const started = Symbol.for("retrospend.autoFinalizePayments");

/** Starts the hourly sweep once per server process, with a first pass now. */
export function startAutoFinalizePayments(everyMs = EVERY_MS) {
	if (env.NODE_ENV === "test") return;
	const g = globalThis as Record<symbol, unknown>;
	if (g[started]) return;
	const run = () =>
		finalizeStaleProposedPayments().catch((error) => {
			console.error("Auto-finalize sweep failed:", errorCode(error));
		});
	const timer = setInterval(run, everyMs);
	// A pending sweep must not keep the process alive.
	timer.unref();
	g[started] = true;
	void run();
}
