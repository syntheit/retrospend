/**
 * Group views of a project's money: the settlement plan, each member's
 * paid / share / net, and the pairwise view from one person. Callers check
 * that the reader is a member (any role) first.
 */
import { getBalancesFromPerspective } from "~/server/services/shared-expenses/balances-perspective.service";
import {
	buildContactVisibility,
	redactContact,
} from "~/server/services/shared-expenses/contact-visibility";
import { computeSettlementPlan } from "~/server/services/shared-expenses/group-settlement";
import type { PrismaClient } from "~prisma";
import { fetchProjectLedger } from "./ledger";
import type { MemberRef, ProjectViewer } from "./types";

/** The fewest payments that bring every balance to zero, per currency. Read-only. */
export async function projectSettlementPlan(
	db: PrismaClient,
	projectId: string,
	periodId?: string,
) {
	const { transactions, settlements } = await fetchProjectLedger(
		db,
		projectId,
		periodId,
	);
	const result = computeSettlementPlan(transactions, settlements);
	return {
		byCurrency: result.byCurrency,
		participantCount: result.participantCount,
	};
}

/** What each person paid, their fair share and their net, one row per currency. */
export async function projectParticipantBalances(
	db: PrismaClient,
	projectId: string,
	periodId?: string,
) {
	const plan = await projectSettlementPlan(db, projectId, periodId);
	return {
		balances: Object.entries(plan.byCurrency).flatMap(([currency, breakdown]) =>
			breakdown.balances.map((b) => ({ ...b, currency })),
		),
		participantCount: plan.participantCount,
	};
}

/**
 * Pairwise balances from one person's side, with the same contact rule as the
 * project detail: viewer links see no emails.
 */
export async function projectBalancesFromPerspective(
	db: PrismaClient,
	projectId: string,
	perspective: MemberRef,
	viewer: ProjectViewer,
) {
	const result = await getBalancesFromPerspective(db, projectId, perspective);
	const visible = await buildContactVisibility(
		db,
		viewer.participantType === "viewerLink"
			? null
			: {
					participantType: viewer.participantType,
					participantId: viewer.participantId,
				},
		[result.perspective, ...result.statements.map((s) => s.counterpart)],
	);
	return {
		...result,
		perspective: redactContact(result.perspective, visible),
		statements: result.statements.map((s) => ({
			...s,
			counterpart: redactContact(s.counterpart, visible),
		})),
	};
}
