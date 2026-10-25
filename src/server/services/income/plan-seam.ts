/**
 * Use my plan (owner N72, INCOME.md): confirming money in assigns it by the
 * plan in the same action. The plan is the envelope budget's own
 * (envelope/use-my-plan.ts): Fill from targets proposes the lines, the rest
 * goes where the person chose (Leave it by default, Save it, Next month;
 * D-owner-2026-10-22e), and one batch writes them inside the confirm's
 * transaction, so the preview lists every line and an undo of the confirm
 * takes the batch back with it.
 */
import { randomUUID } from "node:crypto";
import type { FillFromTargetsOutput, RestChoice } from "~/lib/schemas/envelope";
import type { Money } from "~/server/figures/registry";
import type { Prisma } from "~prisma";
import { forgetMonthViews, monthViewIn } from "../envelope/month-read";
import { undo } from "../envelope/movement.service";
import { applyPlan } from "../envelope/use-my-plan";

type Tx = Prisma.TransactionClient;

export interface PlanRequest {
	readonly userId: string;
	readonly incomeExpenseId: string;
	/** The income's booked value: what the plan may assign. Null when kept in Wealth or no rate values it. */
	readonly amount: Money | null;
	/** Where the rest goes after the targets; Leave it when omitted. */
	readonly rest?: RestChoice;
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
	/** Where the rest went (LEAVE when it stayed or there was none). */
	readonly restChoice: RestChoice;
}

const notApplied = (reason: PlanResult["reason"]): PlanResult => ({
	applied: false,
	reason,
	batchId: null,
	lines: [],
	rest: null,
	restChoice: "LEAVE",
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
	const plan = await applyPlan(tx, request.userId, now, {
		amount: request.amount.minor,
		rest: request.rest ?? "LEAVE",
		// Income rules take their part of this money in first (SPEC §5.4).
		sourceExpenseId: request.incomeExpenseId,
	});
	if (!plan) return notApplied("no_envelope_budget");
	if (!plan.batchId) return notApplied("nothing_to_assign");
	return {
		applied: true,
		reason: null,
		batchId: plan.batchId,
		lines: plan.lines,
		rest: plan.rest,
		restChoice: plan.restChoice,
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
