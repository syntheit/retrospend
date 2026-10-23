/**
 * Use my plan (owner N72, INCOME.md): confirming money in assigns it by the
 * plan in the same action. The plan is the envelope budget's own (2B P2):
 * Fill from targets proposes the lines (`fillFromTargetsIn`, what
 * `envelope.fillFromTargets` shows) and `assign` writes them as one batch,
 * inside the confirm's transaction, so the preview lists every line and an
 * undo of the confirm takes the batch back with it.
 */
import { randomUUID } from "node:crypto";
import type { FillFromTargetsOutput } from "~/lib/schemas/envelope";
import type { Money } from "~/server/figures/registry";
import type { Prisma } from "~prisma";
import {
	fillFromTargetsIn,
	forgetMonthViews,
	monthViewIn,
} from "../envelope/month-read";
import { assign, undo } from "../envelope/movement.service";

type Tx = Prisma.TransactionClient;

export interface PlanRequest {
	readonly userId: string;
	readonly incomeExpenseId: string;
	/** The income's booked value: what the plan may assign. Null when kept in Wealth or no rate values it. */
	readonly amount: Money | null;
}

export interface PlanResult {
	readonly applied: boolean;
	readonly reason:
		| "no_envelope_budget"
		| "not_requested"
		| "nothing_to_assign"
		| "other_currency"
		| null;
	/** The assign batch; the confirm's undo takes it back. */
	readonly batchId: string | null;
	/** Every line the plan assigned (RC-5). */
	readonly lines: FillFromTargetsOutput["lines"];
	/** What stays Not planned yet. */
	readonly rest: Money | null;
}

const notApplied = (reason: PlanResult["reason"]): PlanResult => ({
	applied: false,
	reason,
	batchId: null,
	lines: [],
	rest: null,
});

export const PLAN_NOT_REQUESTED = notApplied("not_requested");

export async function applyPlanFor(
	tx: Tx,
	request: PlanRequest,
): Promise<PlanResult> {
	const now = new Date();
	// The income was just written in this transaction: read the budget anew.
	forgetMonthViews(tx);
	const view = await monthViewIn(tx, request.userId, now);
	if (!view) return notApplied("no_envelope_budget");
	if (!request.amount || request.amount.minor <= 0) {
		return notApplied("nothing_to_assign");
	}
	if (request.amount.currency !== view.dto.book.currency) {
		return notApplied("other_currency");
	}
	const proposal = await fillFromTargetsIn(
		tx,
		request.userId,
		now,
		undefined,
		request.amount.minor,
	);
	const lines = proposal.lines.filter((l) => l.amount.minor > 0);
	if (lines.length === 0) return notApplied("nothing_to_assign");
	const batchId = randomUUID();
	await assign(
		tx,
		request.userId,
		{
			batchId,
			month: proposal.month,
			mode: "add",
			items: lines.map((l) => ({
				id: randomUUID(),
				envelopeId: l.envelopeId,
				amountMinor: l.amount.minor,
			})),
		},
		now,
	);
	return {
		applied: true,
		reason: null,
		batchId,
		lines,
		rest: proposal.rest,
	};
}

/** Takes back a plan batch, as the envelope budget's undo does (one mirror batch). */
export async function undoPlan(
	tx: Tx,
	userId: string,
	batchId: string,
): Promise<void> {
	await undo(tx, userId, { id: randomUUID(), target: { batchId } }, new Date());
}
