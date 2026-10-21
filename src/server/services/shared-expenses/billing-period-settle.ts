import type { Prisma, PrismaClient } from "~prisma";
import { logAudit } from "./audit-log";
import { BALANCE_SETTLEMENT_STATUSES } from "./balance";
import {
	computePeriodOutstanding,
	computeSettlementPlan,
	isFullySettled,
} from "./group-settlement";
import { canonicalizeProjectLedger } from "./identity";
import type { ParticipantRef } from "./types";

const txForPlanSelect = {
	currency: true,
	amount: true,
	paidByType: true,
	paidById: true,
	splitParticipants: {
		select: {
			participantType: true,
			participantId: true,
			shareAmount: true,
		},
	},
} as const;

/**
 * Decide whether a billing period is honestly settled before it can be marked
 * SETTLED. Read-only, creates nothing: a period is only "settled" when real
 * settle-ups have cleared its balances; this never fabricates settlement rows.
 *
 * Settlements are project-scoped but NOT tied to a period (settle-up acts on
 * the project-wide balance, so Settlement.billingPeriodId is never set). A
 * naive "this period's expenses minus every settlement" check therefore counts
 * payments that belong to other periods. Instead:
 * - expenses of this period and every earlier one are compared with all of the
 *   project's counted settlements (BALANCE_SETTLEMENT_STATUSES), applied
 *   oldest debt first
 *   (see computePeriodOutstanding);
 * - if the project as a whole is settled, the period is settled too (a debt
 *   can also be cancelled by a later expense in the other direction).
 */
export async function computePeriodSettleStatus(
	db: PrismaClient | Prisma.TransactionClient,
	period: { id: string; projectId: string; startDate: Date },
) {
	const prisma = db as PrismaClient;

	const [throughPeriods, rawProjectTxs, rawSettlements] = await Promise.all([
		prisma.billingPeriod.findMany({
			where: { projectId: period.projectId },
			select: { id: true, startDate: true },
		}),
		prisma.sharedTransaction.findMany({
			where: { projectId: period.projectId },
			select: { ...txForPlanSelect, billingPeriodId: true },
		}),
		prisma.settlement.findMany({
			where: {
				projectId: period.projectId,
				status: { in: [...BALANCE_SETTLEMENT_STATUSES] },
			},
			select: {
				fromParticipantType: true,
				fromParticipantId: true,
				toParticipantType: true,
				toParticipantId: true,
				amount: true,
				currency: true,
			},
		}),
	]);

	// One ref per person (claimed shadows merged into their users), matching
	// the project views and the alias-aware balances settle-ups use.
	const { transactions: allProjectTxs, settlements } =
		await canonicalizeProjectLedger(
			prisma,
			period.projectId,
			rawProjectTxs,
			rawSettlements,
		);

	const throughIds = new Set(
		throughPeriods
			.filter(
				(p) =>
					p.id === period.id ||
					p.startDate.getTime() < period.startDate.getTime(),
			)
			.map((p) => p.id),
	);
	const throughPeriodTxs = allProjectTxs.filter(
		(tx) => tx.billingPeriodId === null || throughIds.has(tx.billingPeriodId),
	);

	const outstanding = computePeriodOutstanding(throughPeriodTxs, settlements);
	const projectSettled =
		outstanding.length === 0 ||
		isFullySettled(computeSettlementPlan(allProjectTxs, settlements));

	return { outstanding: projectSettled ? [] : outstanding };
}

/**
 * Moves SETTLED billing periods back to CLOSING when they are no longer
 * settled. Called after a payment group is rejected, voided or deleted.
 *
 * Pending (PROPOSED) payments count toward balances, so a period can be
 * marked SETTLED while its settling payment still waits for the payee. If
 * that payment is later rejected or undone, the debt comes back and the
 * period would claim to be settled with money still owed. CLOSING is the
 * state settlePeriod accepts, so the organizer can settle it again once the
 * debt is really paid. This undoes what settlePeriod did: status, settledAt
 * and the lock on the period's expenses.
 *
 * Each reopen is written to the project's activity feed. Returns the ids of
 * the reopened periods.
 */
export async function reopenUnsettledPeriods(
	db: PrismaClient | Prisma.TransactionClient,
	projectIds: Array<string | null>,
	actor: ParticipantRef,
	cause: { reason: string; settlementIds: string[] },
): Promise<string[]> {
	const prisma = db as PrismaClient;
	const reopened: string[] = [];
	const uniqueProjects = [
		...new Set(projectIds.filter((p): p is string => typeof p === "string")),
	];

	for (const projectId of uniqueProjects) {
		const settledPeriods = await prisma.billingPeriod.findMany({
			where: { projectId, status: "SETTLED" },
			select: { id: true, projectId: true, startDate: true },
		});

		for (const period of settledPeriods) {
			const { outstanding } = await computePeriodSettleStatus(prisma, period);
			if (outstanding.length === 0) continue;

			// Status guard: a concurrent reopen of the same period is a no-op.
			const { count } = await prisma.billingPeriod.updateMany({
				where: { id: period.id, status: "SETTLED" },
				data: { status: "CLOSING", settledAt: null },
			});
			if (count === 0) continue;

			await prisma.sharedTransaction.updateMany({
				where: { billingPeriodId: period.id },
				data: { isLocked: false },
			});

			await logAudit(prisma, {
				actor,
				action: "PERIOD_REOPENED",
				targetType: "BILLING_PERIOD",
				targetId: period.id,
				changes: {
					previousStatus: "SETTLED",
					newStatus: "CLOSING",
					reason: cause.reason,
					settlementIds: cause.settlementIds,
				},
				projectId,
			});
			reopened.push(period.id);
		}
	}

	return reopened;
}
