/**
 * Project reads: the list, the detail page, and the public page. Callers
 * check access first (requireProjectRole or the public-visibility test).
 */
import { TRPCError } from "@trpc/server";
import {
	BALANCE_SETTLEMENT_STATUSES,
	COUNTED_SHARE,
} from "~/server/services/shared-expenses/balance";
import {
	buildContactVisibility,
	redactContact,
} from "~/server/services/shared-expenses/contact-visibility";
import {
	computeSettlementPlan,
	isFullySettled,
} from "~/server/services/shared-expenses/group-settlement";
import type { PrismaClient } from "~prisma";
import { redactParticipantEmails, resolveParticipantNames } from "./identities";
import type { ProjectViewer } from "./types";

function groupBy<T>(rows: readonly T[], key: (row: T) => string) {
	const out = new Map<string, T[]>();
	for (const row of rows) {
		const list = out.get(key(row));
		if (list) list.push(row);
		else out.set(key(row), [row]);
	}
	return out;
}

/**
 * Whether each multi-member project with expenses is settled. Two queries
 * for the whole batch instead of two per project.
 */
async function settledByProject(
	db: PrismaClient,
	projectIds: string[],
): Promise<Map<string, boolean>> {
	const result = new Map<string, boolean>();
	if (projectIds.length === 0) return result;
	const [txns, settlements] = await Promise.all([
		db.sharedTransaction.findMany({
			where: { projectId: { in: projectIds } },
			select: {
				projectId: true,
				currency: true,
				amount: true,
				paidByType: true,
				paidById: true,
				splitParticipants: {
					where: COUNTED_SHARE,
					select: {
						participantType: true,
						participantId: true,
						shareAmount: true,
					},
				},
			},
		}),
		db.settlement.findMany({
			where: {
				projectId: { in: projectIds },
				status: { in: [...BALANCE_SETTLEMENT_STATUSES] },
			},
			select: {
				projectId: true,
				fromParticipantType: true,
				fromParticipantId: true,
				toParticipantType: true,
				toParticipantId: true,
				amount: true,
				currency: true,
			},
		}),
	]);
	const txByProject = groupBy(txns, (t) => t.projectId as string);
	const settlementsByProject = groupBy(
		settlements,
		(s) => s.projectId as string,
	);
	for (const pid of projectIds) {
		const projectTxns = txByProject.get(pid) ?? [];
		if (projectTxns.length === 0) continue;
		const plan = computeSettlementPlan(
			projectTxns,
			settlementsByProject.get(pid) ?? [],
		);
		result.set(pid, isFullySettled(plan));
	}
	return result;
}

function findMyProjects(
	db: PrismaClient,
	userId: string,
	status?: "ACTIVE" | "ARCHIVED",
) {
	return db.project.findMany({
		where: {
			participants: {
				some: { participantType: "user", participantId: userId },
			},
			...(status ? { status } : {}),
		},
		include: {
			_count: { select: { participants: true, sharedTransactions: true } },
			participants: { take: 5, orderBy: { joinedAt: "asc" } },
			billingPeriods: {
				where: { status: "OPEN" },
				take: 1,
				orderBy: { startDate: "desc" },
			},
		},
		orderBy: { updatedAt: "desc" },
	});
}

type ListedProject = Awaited<ReturnType<typeof findMyProjects>>[number];

/** The first few members of each project, named, with the shared contact rule applied. */
async function namedMembers(
	db: PrismaClient,
	userId: string,
	projects: ListedProject[],
) {
	const resolved = await resolveParticipantNames(
		db,
		projects.flatMap((p) =>
			p.participants.map((pp) => ({ ...pp, _projectId: p.id })),
		),
	);
	const visible = await buildContactVisibility(
		db,
		{ participantType: "user", participantId: userId },
		resolved,
	);
	return groupBy(
		resolved.map((pp) => redactContact(pp, visible)),
		(pp) => pp._projectId,
	);
}

export async function listProjects(
	db: PrismaClient,
	userId: string,
	status?: "ACTIVE" | "ARCHIVED",
) {
	const projects = await findMyProjects(db, userId, status);
	const members = await namedMembers(db, userId, projects);
	const settled = await settledByProject(
		db,
		projects
			.filter(
				(p) => p._count.participants > 1 && p._count.sharedTransactions > 0,
			)
			.map((p) => p.id),
	);
	const isMe = (pp: { participantType: string; participantId: string }) =>
		pp.participantType === "user" && pp.participantId === userId;

	const enriched = projects.map((p) => {
		const people = members.get(p.id) ?? [];
		return {
			...p,
			participants: people,
			myRole: people.find(isMe)?.role ?? null,
			excludeFromAnalytics:
				p.participants.find(isMe)?.excludeFromAnalytics ?? false,
			currentBillingPeriod: p.billingPeriods[0] ?? null,
			isSettled: settled.get(p.id) ?? false,
		};
	});

	// ACTIVE first, then by updatedAt desc (already ordered).
	return enriched.sort((a, b) => {
		if (a.status === "ACTIVE" && b.status !== "ACTIVE") return -1;
		if (a.status !== "ACTIVE" && b.status === "ACTIVE") return 1;
		return 0;
	});
}

export async function getProjectDetail(
	db: PrismaClient,
	projectId: string,
	viewer: ProjectViewer,
) {
	const project = await db.project.findUnique({
		where: { id: projectId },
		include: {
			participants: true,
			billingPeriods: { orderBy: { startDate: "desc" } },
		},
	});
	if (!project) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
	}

	const { participantType, participantId } = viewer;
	const isLink = participantType === "viewerLink";
	const isMe = (pp: { participantType: string; participantId: string }) =>
		pp.participantType === participantType &&
		pp.participantId === participantId;

	const resolved = await resolveParticipantNames(db, project.participants);
	const myRole = isLink
		? ("VIEWER" as const)
		: (resolved.find(isMe)?.role ?? null);
	// Ghost and guest emails only for their creator, the guest themself, or
	// editors and owners (shared rule). Viewer links see none.
	const participants = await redactParticipantEmails(
		db,
		isLink ? null : { participantType, participantId },
		resolved,
	);
	const currentBillingPeriod = project.billingCycleLength
		? (project.billingPeriods.find((p) => p.status === "OPEN") ?? null)
		: null;

	// A viewer link is never a split participant, so it has nothing unseen.
	const unseenChangesCount = isLink
		? 0
		: await db.splitParticipant.count({
				where: {
					transaction: { projectId },
					participantType,
					participantId,
					hasUnseenChanges: true,
				},
			});
	const pendingVerificationCount = await db.splitParticipant.count({
		where: { transaction: { projectId }, verificationStatus: "PENDING" },
	});

	return {
		...project,
		participants,
		currentBillingPeriod,
		unseenChangesCount,
		pendingVerificationCount,
		myRole,
		myParticipantType: participantType,
		myParticipantId: participantId,
		excludeFromAnalytics:
			project.participants.find(isMe)?.excludeFromAnalytics ?? false,
	};
}

