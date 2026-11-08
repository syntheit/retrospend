import { TRPCError } from "@trpc/server";
import type { ParticipantType, PrismaClient } from "~prisma";

/** The global client or a transaction on it (the app role cannot write the log). */
type LogDb = Pick<PrismaClient, "adminAccessLog">;
type RemovalDb = Pick<PrismaClient, "adminAccessLog" | "user">;
type ParticipantDb = Pick<
	PrismaClient,
	| "splitParticipant"
	| "sharedTransaction"
	| "settlement"
	| "payment"
	| "project"
	| "projectParticipant"
>;

/**
 * The admin access log: every time an admin acts on a person's account, one
 * row says what, and the person reads it in Settings. The codes are stable and
 * carry no text from the account (no names, titles or amounts).
 */
export const ADMIN_ACCESS_ACTIONS = [
	"password_reset",
	"reset_link",
	"disabled",
	"enabled",
	"email_verified",
	"email_verification_changed",
	"ai_access_changed",
	"avatar_removed",
	"person_deleted",
	"shared_data_changed",
] as const;

export type AdminAccessAction = (typeof ADMIN_ACCESS_ACTIONS)[number];

/**
 * Records an admin acting on a person's account. Call it once the action has
 * succeeded, or inside the action's own transaction, so a refused or failed
 * action leaves no entry. Needs the global connection (the app role has no
 * write on this table). A missing person is a NOT_FOUND, not a database error.
 */
export async function recordAdminAccess(
	db: LogDb,
	params: { adminId: string; userId: string; action: AdminAccessAction },
): Promise<void> {
	try {
		await db.adminAccessLog.create({
			data: {
				userId: params.userId,
				adminId: params.adminId,
				action: params.action,
			},
		});
	} catch (error) {
		if ((error as { code?: string }).code === "P2003") {
			throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
		}
		throw error;
	}
}

/** The admin procedures that act on one person's account, and what each is logged as. */
const ACTION_BY_PROCEDURE: Record<string, AdminAccessAction> = {
	resetPassword: "password_reset",
	generatePasswordResetLink: "reset_link",
	disableUser: "disabled",
	enableUser: "enabled",
	markEmailVerified: "email_verified",
	toggleEmailVerification: "email_verification_changed",
	setUserAiAccess: "ai_access_changed",
	removeUserAvatar: "avatar_removed",
};

/**
 * The one hook for the log: adminProcedure calls it after an admin procedure
 * has succeeded. A procedure not in the table above, or one without a
 * `userId` in its input, is not an action on an account and logs nothing.
 * (The procedures that act on other people's data through a Person log inside
 * their own transaction, with recordParticipantRemoval.)
 */
export async function logAdminProcedure(
	db: LogDb,
	call: { path: string; adminId: string; rawInput: unknown },
): Promise<void> {
	const name = call.path.replace(/^admin\./, "");
	const action = Object.hasOwn(ACTION_BY_PROCEDURE, name)
		? ACTION_BY_PROCEDURE[name]
		: undefined;
	const userId = (call.rawInput as { userId?: unknown } | null)?.userId;
	if (!action || typeof userId !== "string" || userId === "") return;
	await recordAdminAccess(db, { adminId: call.adminId, userId, action });
}

/**
 * The users whose shared expenses or payments name this Person or guest, found
 * before it is deleted: the creators, payers and other split members of the
 * expenses it is in, the sides and recorder of its payments, and the creator
 * and user members of every project it was on. Ids only; may include the
 * sentinel of a deleted account, which recordParticipantRemoval drops.
 */
export async function usersSharingWithParticipant(
	db: ParticipantDb,
	participantType: ParticipantType,
	participantId: string,
): Promise<string[]> {
	const splits = await db.splitParticipant.findMany({
		where: { participantType, participantId },
		select: { transactionId: true },
	});
	const expenses = await db.sharedTransaction.findMany({
		where: {
			OR: [
				{ id: { in: splits.map((s) => s.transactionId) } },
				{ paidByType: participantType, paidById: participantId },
				{ createdByType: participantType, createdById: participantId },
			],
		},
		select: {
			id: true,
			paidByType: true,
			paidById: true,
			createdByType: true,
			createdById: true,
		},
	});
	const members = await db.splitParticipant.findMany({
		where: { transactionId: { in: expenses.map((e) => e.id) }, participantType: "user" },
		select: { participantId: true },
	});
	const payments = await db.settlement.findMany({
		where: {
			OR: [
				{ fromParticipantType: participantType, fromParticipantId: participantId },
				{ toParticipantType: participantType, toParticipantId: participantId },
			],
		},
		select: {
			fromParticipantType: true,
			fromParticipantId: true,
			toParticipantType: true,
			toParticipantId: true,
		},
	});
	const headers = await db.payment.findMany({
		where: {
			OR: [
				{ payerType: participantType, payerId: participantId },
				{ payeeType: participantType, payeeId: participantId },
				{ recordedByType: participantType, recordedById: participantId },
			],
		},
		select: {
			payerType: true,
			payerId: true,
			payeeType: true,
			payeeId: true,
			recordedByType: true,
			recordedById: true,
		},
	});
	const projectIds = (
		await db.projectParticipant.findMany({
			where: { participantType, participantId },
			select: { projectId: true },
		})
	).map((r) => r.projectId);
	const projects = await db.project.findMany({
		where: { id: { in: projectIds } },
		select: { createdById: true },
	});
	const roster = await db.projectParticipant.findMany({
		where: { projectId: { in: projectIds }, participantType: "user" },
		select: { participantId: true },
	});
	const users = new Set<string>();
	for (const p of projects) users.add(p.createdById);
	for (const r of roster) users.add(r.participantId);
	for (const h of headers) {
		if (h.payerType === "user") users.add(h.payerId);
		if (h.payeeType === "user") users.add(h.payeeId);
		if (h.recordedByType === "user") users.add(h.recordedById);
	}
	for (const e of expenses) {
		if (e.paidByType === "user") users.add(e.paidById);
		if (e.createdByType === "user") users.add(e.createdById);
	}
	for (const m of members) users.add(m.participantId);
	for (const p of payments) {
		if (p.fromParticipantType === "user") users.add(p.fromParticipantId);
		if (p.toParticipantType === "user") users.add(p.toParticipantId);
	}
	return [...users];
}

/**
 * Logs an admin deleting a Person or guest: "person_deleted" for the user who
 * added the Person (if any), "shared_data_changed" for each user whose
 * expenses or payments were rewritten. Call it inside the deleting
 * transaction. Ids with no user row (the sentinel of a deleted account) are
 * skipped, so the log never makes the delete fail.
 */
export async function recordParticipantRemoval(
	db: RemovalDb,
	params: { adminId: string; ownerId?: string; affectedUserIds: string[] },
): Promise<void> {
	const existing = new Set(
		(
			await db.user.findMany({
				where: {
					id: {
						in: [
							...params.affectedUserIds,
							...(params.ownerId ? [params.ownerId] : []),
						],
					},
				},
				select: { id: true },
			})
		).map((u) => u.id),
	);
	const rows: { userId: string; action: AdminAccessAction }[] = [
		...(params.ownerId && existing.has(params.ownerId)
			? [{ userId: params.ownerId, action: "person_deleted" as const }]
			: []),
		...params.affectedUserIds
			.filter((id) => existing.has(id))
			.map((userId) => ({ userId, action: "shared_data_changed" as const })),
	];
	await db.adminAccessLog.createMany({
		data: rows.map((r) => ({ ...r, adminId: params.adminId })),
	});
}

/** The person's own entries, newest first. Pass a user-scoped client. */
export async function listOwnAdminAccess(db: PrismaClient, limit = 50) {
	const rows = await db.adminAccessLog.findMany({
		select: { id: true, action: true, createdAt: true },
		orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		take: limit,
	});
	return rows.map((r) => ({
		id: r.id,
		action: r.action as AdminAccessAction,
		createdAt: r.createdAt,
	}));
}
