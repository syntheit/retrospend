/**
 * A project's expense list, for members and for the public page. Both pages
 * show the same rows; only status and edit rights differ.
 */
import { computeTransactionStatus } from "~/server/services/shared-expenses/verification.service";
import type { Prisma, PrismaClient } from "~prisma";
import { batchResolveIdentities, type Identity } from "./identities";
import type { ProjectRoleName, ProjectViewer } from "./types";

interface Page {
	page: number;
	limit: number;
}

const pageArgs = (
	where: Prisma.SharedTransactionWhereInput,
	{ page, limit }: Page,
) =>
	({
		where,
		orderBy: { date: "desc" },
		skip: (page - 1) * limit,
		take: limit,
	}) as const;

const categorySelect = {
	select: { id: true, name: true, color: true, icon: true },
} as const;

/** Payers and split participants of a page, resolved in one batch. */
function pageIdentities(
	db: PrismaClient,
	transactions: Array<{
		paidByType: string;
		paidById: string;
		splitParticipants: Array<{
			participantType: string;
			participantId: string;
		}>;
	}>,
) {
	return batchResolveIdentities(
		db,
		transactions.flatMap((tx) => [
			{ participantType: tx.paidByType, participantId: tx.paidById },
			...tx.splitParticipants,
		]),
	);
}

type Row = {
	id: string;
	description: string;
	amount: Prisma.Decimal;
	currency: string;
	date: Date;
	category: {
		id: string;
		name: string;
		color: string;
		icon: string | null;
	} | null;
	splitMode: string;
	isLocked: boolean;
	paidByType: string;
	paidById: string;
};

/** The fields both lists share, with the payer resolved. */
function baseRow(tx: Row, identities: Map<string, Identity>, isMe: boolean) {
	const payer = identities.get(`${tx.paidByType}:${tx.paidById}`);
	return {
		id: tx.id,
		description: tx.description,
		amount: Number(tx.amount),
		currency: tx.currency,
		date: tx.date,
		category: tx.category,
		splitMode: tx.splitMode,
		isLocked: tx.isLocked,
		paidBy: {
			type: tx.paidByType,
			id: tx.paidById,
			name: payer?.name ?? "Unknown",
			avatarUrl: payer?.avatarUrl ?? null,
			isMe,
		},
	};
}

function withIdentity<
	T extends {
		participantType: string;
		participantId: string;
		shareAmount: Prisma.Decimal;
	},
>(sp: T, identities: Map<string, Identity>) {
	const identity = identities.get(`${sp.participantType}:${sp.participantId}`);
	return {
		...sp,
		shareAmount: Number(sp.shareAmount),
		name: identity?.name ?? "Unknown",
		avatarUrl: identity?.avatarUrl ?? null,
	};
}

export async function listProjectExpenses(
	db: PrismaClient,
	input: Page & { projectId: string; billingPeriodId?: string },
	viewer: ProjectViewer,
	viewerRole: ProjectRoleName,
) {
	const where: Prisma.SharedTransactionWhereInput = {
		projectId: input.projectId,
		...(input.billingPeriodId
			? { billingPeriodId: input.billingPeriodId }
			: {}),
	};
	const [transactions, total] = await Promise.all([
		db.sharedTransaction.findMany({
			...pageArgs(where, input),
			include: {
				category: categorySelect,
				splitParticipants: {
					select: {
						id: true,
						participantType: true,
						participantId: true,
						shareAmount: true,
						verificationStatus: true,
						hasUnseenChanges: true,
					},
				},
			},
		}),
		db.sharedTransaction.count({ where }),
	]);
	const identities = await pageIdentities(db, transactions);
	const { participantType, participantId } = viewer;
	const isViewer = (type: string, id: string) =>
		type === participantType && id === participantId;

	const enriched = transactions.map((tx) => {
		const isCreator = isViewer(tx.createdByType, tx.createdById);
		const canModify =
			!tx.isLocked &&
			(viewerRole === "ORGANIZER" ||
				viewerRole === "EDITOR" ||
				(viewerRole === "CONTRIBUTOR" && isCreator));
		return {
			...baseRow(tx, identities, isViewer(tx.paidByType, tx.paidById)),
			status: tx.isLocked
				? "settled"
				: computeTransactionStatus(tx.splitParticipants),
			canEdit: canModify,
			canDelete: canModify,
			hasUnseenChanges:
				tx.splitParticipants.find((sp) =>
					isViewer(sp.participantType, sp.participantId),
				)?.hasUnseenChanges ?? false,
			splitParticipants: tx.splitParticipants.map((sp) =>
				withIdentity(sp, identities),
			),
		};
	});
	return {
		transactions: enriched,
		total,
		page: input.page,
		limit: input.limit,
	};
}

/** Read-only rows for a PUBLIC project, or null. Nothing is editable here. */
export async function listPublicProjectExpenses(
	db: PrismaClient,
	input: Page & { projectId: string },
) {
	const project = await db.project.findUnique({
		where: { id: input.projectId },
		select: { visibility: true },
	});
	if (!project || project.visibility !== "PUBLIC") return null;

	const where = { projectId: input.projectId };
	const [transactions, total] = await Promise.all([
		db.sharedTransaction.findMany({
			...pageArgs(where, input),
			include: {
				category: categorySelect,
				splitParticipants: {
					select: {
						id: true,
						participantType: true,
						participantId: true,
						shareAmount: true,
					},
				},
			},
		}),
		db.sharedTransaction.count({ where }),
	]);
	const identities = await pageIdentities(db, transactions);
	const enriched = transactions.map((tx) => ({
		...baseRow(tx, identities, false),
		status: "active" as const,
		canEdit: false,
		canDelete: false,
		hasUnseenChanges: false,
		splitParticipants: tx.splitParticipants.map((sp) =>
			withIdentity(sp, identities),
		),
	}));
	return {
		transactions: enriched,
		total,
		page: input.page,
		limit: input.limit,
	};
}
