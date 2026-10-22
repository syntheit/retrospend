/**
 * Project reads: the list, the detail page, and the public page. Callers
 * check access first (requireProjectRole or the public-visibility test).
 */
import { TRPCError } from "@trpc/server";
import { BALANCE_SETTLEMENT_STATUSES } from "~/server/services/shared-expenses/balance";
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

/** Spending per category. Sums raw amounts across currencies, as the pages always have. */
async function categoryStats(db: PrismaClient, projectId: string) {
	const raw = await db.sharedTransaction.groupBy({
		by: ["categoryId"],
		where: { projectId },
		_sum: { amount: true },
		_count: { _all: true },
	});
	const totalSpent = raw.reduce(
		(sum, s) => sum + (s._sum.amount ? Number(s._sum.amount) : 0),
		0,
	);
	const ids = raw
		.map((s) => s.categoryId)
		.filter((id): id is string => id !== null);
	const categories =
		ids.length > 0
			? await db.category.findMany({
					where: { id: { in: ids } },
					select: { id: true, name: true, color: true },
				})
			: [];
	const byId = new Map(categories.map((c) => [c.id, c]));
	const stats = raw.map((s) => {
		const cat = s.categoryId ? byId.get(s.categoryId) : null;
		return {
			categoryId: s.categoryId,
			name: cat?.name ?? "Uncategorized",
			color: cat?.color ?? "gray",
			total: s._sum.amount ? Number(s._sum.amount) : 0,
			count: s._count._all,
		};
	});
	return { totalSpent, categoryStats: stats };
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
	const group = <T extends { projectId: string | null }>(rows: T[]) => {
		const out = new Map<string, T[]>();
		for (const row of rows) {
			const pid = row.projectId as string;
			out.set(pid, [...(out.get(pid) ?? []), row]);
		}
		return out;
	};
	const txByProject = group(txns);
	const settlementsByProject = group(settlements);
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

export async function listProjects(
	db: PrismaClient,
	userId: string,
	status?: "ACTIVE" | "ARCHIVED",
) {
	const projects = await db.project.findMany({
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

	const resolved = await resolveParticipantNames(
		db,
		projects.flatMap((p) =>
			p.participants.map((pp) => ({ ...pp, _projectId: p.id })),
		),
	);
	// Ghost and guest emails only for those allowed to see them (shared rule).
	const visible = await buildContactVisibility(
		db,
		{ participantType: "user", participantId: userId },
		resolved,
	);
	const byProject = new Map<string, typeof resolved>();
	for (const rp of resolved) {
		byProject.set(rp._projectId, [...(byProject.get(rp._projectId) ?? []), rp]);
	}

	const projectIds = projects.map((p) => p.id);
	const spent =
		projectIds.length > 0
			? await db.sharedTransaction.groupBy({
					by: ["projectId"],
					where: { projectId: { in: projectIds } },
					_sum: { amount: true },
				})
			: [];
	const spentMap = new Map(
		spent.map((g) => [g.projectId, Number(g._sum.amount ?? 0)]),
	);
	const settled = await settledByProject(
		db,
		projects
			.filter(
				(p) => p._count.participants > 1 && p._count.sharedTransactions > 0,
			)
			.map((p) => p.id),
	);

	const enriched = projects.map((p) => {
		const people = byProject.get(p.id) ?? [];
		const isMe = (pp: { participantType: string; participantId: string }) =>
			pp.participantType === "user" && pp.participantId === userId;
		return {
			...p,
			participants: people.map((pp) => redactContact(pp, visible)),
			myRole: people.find(isMe)?.role ?? null,
			excludeFromAnalytics:
				p.participants.find(isMe)?.excludeFromAnalytics ?? false,
			totalSpent: spentMap.get(p.id) ?? 0,
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
	const { totalSpent, categoryStats: stats } = await categoryStats(
		db,
		projectId,
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
		categoryStats: stats,
		totalSpent,
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

/**
 * The public page of a PUBLIC project, or null. Anyone on the internet can
 * read it, so it returns only what that page shows: no emails, no balances,
 * no per-member preferences.
 */
export async function getPublicProjectDetail(
	db: PrismaClient,
	projectId: string,
) {
	const project = await db.project.findUnique({
		where: { id: projectId },
		include: {
			participants: true,
			billingPeriods: {
				where: { status: "OPEN" },
				take: 1,
				orderBy: { startDate: "desc" },
			},
		},
	});
	if (!project || project.visibility !== "PUBLIC") return null;

	const participants = (
		await resolveParticipantNames(db, project.participants)
	).map((p) => ({
		id: p.id,
		participantType: p.participantType,
		participantId: p.participantId,
		role: p.role,
		joinedAt: p.joinedAt,
		name: p.name,
		username: p.username,
		avatarUrl: p.avatarUrl,
	}));
	const { totalSpent, categoryStats: stats } = await categoryStats(
		db,
		projectId,
	);

	return {
		id: project.id,
		name: project.name,
		description: project.description,
		status: project.status,
		imagePath: project.imagePath,
		budgetAmount: project.budgetAmount,
		budgetCurrency: project.budgetCurrency,
		primaryCurrency: project.primaryCurrency,
		visibility: project.visibility,
		autoAcceptSplits: project.autoAcceptSplits,
		createdAt: project.createdAt,
		participants,
		categoryStats: stats,
		totalSpent,
		currentBillingPeriod: project.billingCycleLength
			? (project.billingPeriods[0] ?? null)
			: null,
	};
}
