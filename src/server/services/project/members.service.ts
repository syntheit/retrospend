/**
 * Project membership: adding people, roles, ownership and removal. Callers
 * have already checked the caller's role with requireProjectRole and pass it
 * in, because several rules depend on it.
 */
import { TRPCError } from "@trpc/server";
import { env } from "~/env";
import { userTransaction } from "~/server/db-tx";
import { renderNoticeEmail } from "~/server/services/notice-email";
import { sendEmail } from "~/server/mailer";
import { buildNoticeText } from "~/server/services/notification-text";
import {
	createNotification,
	resolveParticipantName,
} from "~/server/services/notifications";
import { logAudit } from "~/server/services/shared-expenses/audit-log";
import type { PrismaClient } from "~prisma";
import { defaultJoinedOn } from "./join-date";
import { fromIsoDate, type IsoDate } from "./membership";
import { badDates } from "./membership.service";
import type { MemberRef, ProjectActor, ProjectRoleName } from "./types";

/**
 * Granting Owner requires the caller to be an Owner. Editors may grant
 * Editor and below. Mirrors magic links, which refuse Owner.
 */
function assertCanGrantRole(callerRole: string, grantedRole: string): void {
	if (grantedRole === "ORGANIZER" && callerRole !== "ORGANIZER") {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Only an Owner can make someone an Owner",
		});
	}
}

/**
 * Ghosts cannot sign in, so they never hold Editor or Owner: claiming the
 * ghost or merging a guest would otherwise hand that role to whoever claims it.
 */
function capGhostRole(
	participantType: string,
	role: ProjectRoleName,
): ProjectRoleName {
	return participantType === "shadow" &&
		(role === "ORGANIZER" || role === "EDITOR")
		? "CONTRIBUTOR"
		: role;
}

const appUrl = () => env.PUBLIC_URL || env.NEXT_PUBLIC_APP_URL || "";

function findMember(db: PrismaClient, projectId: string, ref: MemberRef) {
	return db.projectParticipant.findUnique({
		where: {
			projectId_participantType_participantId: { projectId, ...ref },
		},
	});
}

async function assertAddable(
	db: PrismaClient,
	userId: string,
	projectId: string,
	ref: MemberRef,
) {
	// Only ghosts the caller created: otherwise any owner could add another
	// user's ghost and expose its name and email to their project.
	if (ref.participantType === "shadow") {
		const shadow = await db.shadowProfile.findUnique({
			where: { id: ref.participantId },
			select: { createdById: true },
		});
		if (!shadow) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Shadow profile not found",
			});
		}
		if (shadow.createdById !== userId) {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "You can only add shadow profiles you created",
			});
		}
	}
	// A friendly error before the unique constraint would fire.
	if (await findMember(db, projectId, ref)) {
		throw new TRPCError({
			code: "CONFLICT",
			message: "This participant is already in the project",
		});
	}
}

export async function addParticipant(
	db: PrismaClient,
	{ userId }: ProjectActor,
	callerRole: ProjectRoleName,
	input: MemberRef & {
		projectId: string;
		role: ProjectRoleName;
		/** When they join (RC-11); omitted, defaultJoinedOn decides. */
		joinedOn?: IsoDate;
	},
) {
	const { projectId, participantType, participantId } = input;
	const day = input.joinedOn;
	const typedJoin = day ? badDates(() => fromIsoDate(day)) : null;
	await assertAddable(db, userId, projectId, {
		participantType,
		participantId,
	});
	const role = capGhostRole(participantType, input.role);
	assertCanGrantRole(callerRole, role);

	const participant = await userTransaction(db, userId, async (tx) => {
		const joinedOn =
			typedJoin ?? (await defaultJoinedOn(tx, projectId, userId));
		const p = await tx.projectParticipant.create({
			data: { projectId, participantType, participantId, role, joinedOn },
		});
		await logAudit(tx, {
			actor: { participantType: "user", participantId: userId },
			action: "PARTICIPANT_ADDED",
			targetType: "PROJECT",
			targetId: projectId,
			changes: {
				participantType,
				participantId,
				role,
				...(input.joinedOn ? { joinedOn: input.joinedOn } : {}),
			},
			projectId,
		});
		return p;
	});

	if (participantType === "user") {
		await notifyAddedUser(db, userId, projectId, participantId);
	} else if (participantType === "shadow") {
		await inviteAddedGhost(db, userId, projectId, participantId, role);
	}
	return participant;
}

async function notifyAddedUser(
	db: PrismaClient,
	userId: string,
	projectId: string,
	addedUserId: string,
) {
	createNotification({
		userId: addedUserId,
		type: "PARTICIPANT_ADDED",
		notice: {
			kind: "addedToProject",
			actor: { type: "user", id: userId },
		},
		data: { projectId },
	}).catch((err) =>
		console.error("[Notification Error] PARTICIPANT_ADDED:", err),
	);
}

/**
 * Emails a ghost with an address a single-use join link. The link grants the
 * ghost's own (capped) role, so joining through it never outranks the row it
 * stands for.
 */
async function inviteAddedGhost(
	db: PrismaClient,
	userId: string,
	projectId: string,
	shadowId: string,
	role: ProjectRoleName,
) {
	const shadow = await db.shadowProfile.findUnique({
		where: { id: shadowId },
		select: { name: true, email: true },
	});
	if (!shadow?.email) return;
	const actorName = await resolveParticipantName("user", userId);
	const base = appUrl();

	let joinUrl: string | undefined;
	try {
		const link = await db.magicLink.create({
			data: {
				id: crypto.randomUUID(),
				projectId,
				roleGranted: role,
				createdById: userId,
				maxUses: 1,
			},
		});
		joinUrl = base
			? `${base}/projects/${projectId}?invite=${link.id}`
			: undefined;
	} catch (err) {
		console.error(
			"[Invitation] Failed to create magic link for shadow email:",
			err,
		);
	}

	// A person without an account has no language on file: English.
	const text = await buildNoticeText(
		{ kind: "projectInvite", hasLink: Boolean(joinUrl) },
		{},
		actorName,
	).catch((err) => {
		console.error("[Invitation] Could not word the invite email:", err);
		return null;
	});
	// No email rather than a wrong one; the person was still added.
	if (!text) return;
	const email = await renderNoticeEmail(
		text,
		{},
		{ ctaUrl: joinUrl ?? undefined },
	);
	sendEmail(shadow.email, email.subject, email.html).catch((err) =>
		console.error("[Notification Error] shadow PARTICIPANT_ADDED email:", err),
	);
}

async function requireMember(
	db: PrismaClient,
	projectId: string,
	ref: MemberRef,
) {
	const target = await findMember(db, projectId, ref);
	if (!target) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Participant not found in this project",
		});
	}
	return target;
}

const creatorOf = (db: PrismaClient, projectId: string) =>
	db.project.findUniqueOrThrow({
		where: { id: projectId },
		select: { createdById: true, name: true },
	});

export async function updateParticipantRole(
	db: PrismaClient,
	{ userId }: ProjectActor,
	callerRole: ProjectRoleName,
	input: MemberRef & { projectId: string; role: ProjectRoleName },
) {
	const { projectId, participantType, participantId } = input;
	if (participantType === "user" && participantId === userId) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "You cannot change your own role",
		});
	}
	const target = await requireMember(db, projectId, {
		participantType,
		participantId,
	});
	if (callerRole !== "ORGANIZER" && target.role === "ORGANIZER") {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Only an Owner can change another Owner's role",
		});
	}
	const project = await creatorOf(db, projectId);
	if (
		target.participantType === "user" &&
		target.participantId === project.createdById &&
		input.role !== "ORGANIZER"
	) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "The project creator cannot be demoted below Owner",
		});
	}
	const role = capGhostRole(participantType, input.role);
	assertCanGrantRole(callerRole, role);

	return userTransaction(db, userId, async (tx) => {
		const updated = await tx.projectParticipant.update({
			where: { id: target.id },
			data: { role },
		});
		await logAudit(tx, {
			actor: { participantType: "user", participantId: userId },
			action: "ROLE_CHANGED",
			targetType: "PROJECT",
			targetId: projectId,
			changes: {
				participantType,
				participantId,
				oldRole: target.role,
				newRole: role,
			},
			projectId,
		});
		return updated;
	});
}

interface TransferInput {
	projectId: string;
	newOwnerId: string;
	confirmProjectName: string;
}

/** The new owner's membership row, after every check a transfer needs. */
async function transferTarget(
	db: PrismaClient,
	userId: string,
	project: { createdById: string; name: string },
	input: TransferInput,
) {
	const { projectId, newOwnerId } = input;
	if (project.createdById !== userId) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Only the project owner can transfer ownership",
		});
	}
	// Typing the name guards against an accidental transfer.
	if (input.confirmProjectName !== project.name) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Project name does not match",
		});
	}
	const target = await findMember(db, projectId, {
		participantType: "user",
		participantId: newOwnerId,
	});
	if (!target) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Target user is not a participant in this project",
		});
	}
	if (target.participantId === userId) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "You are already the owner",
		});
	}
	return target;
}

/** Caller must be an owner and the creator; the old owner becomes an editor. */
export async function transferOwnership(
	db: PrismaClient,
	{ userId }: ProjectActor,
	input: TransferInput,
) {
	const { projectId, newOwnerId } = input;
	const project = await creatorOf(db, projectId);
	const target = await transferTarget(db, userId, project, input);

	const result = await userTransaction(db, userId, async (tx) => {
		await tx.projectParticipant.update({
			where: { id: target.id },
			data: { role: "ORGANIZER" },
		});
		await tx.projectParticipant.updateMany({
			where: { projectId, participantType: "user", participantId: userId },
			data: { role: "EDITOR" },
		});
		await tx.project.update({
			where: { id: projectId },
			data: { createdById: newOwnerId },
		});
		await logAudit(tx, {
			actor: { participantType: "user", participantId: userId },
			action: "ROLE_CHANGED",
			targetType: "PROJECT",
			targetId: projectId,
			changes: {
				message: "Ownership transferred",
				previousOwner: userId,
				newOwner: newOwnerId,
			},
			projectId,
		});
		return { success: true };
	});

	void createNotification({
		userId: newOwnerId,
		type: "PARTICIPANT_ADDED",
		notice: {
			kind: "ownershipTransferred",
			actor: { type: "user", id: userId },
		},
		data: { projectId },
	});
	return result;
}

export async function removeParticipant(
	db: PrismaClient,
	{ userId }: ProjectActor,
	callerRole: ProjectRoleName,
	input: MemberRef & { projectId: string },
) {
	const { projectId, participantType, participantId } = input;
	const project = await creatorOf(db, projectId);
	if (participantType === "user" && participantId === project.createdById) {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "The project creator cannot be removed",
		});
	}
	const target = await requireMember(db, projectId, {
		participantType,
		participantId,
	});
	if (callerRole !== "ORGANIZER" && target.role === "ORGANIZER") {
		throw new TRPCError({
			code: "FORBIDDEN",
			message: "Only an Owner can remove another Owner",
		});
	}
	await userTransaction(db, userId, async (tx) => {
		await tx.projectParticipant.delete({ where: { id: target.id } });
		await logAudit(tx, {
			actor: { participantType: "user", participantId: userId },
			action: "PARTICIPANT_REMOVED",
			targetType: "PROJECT",
			targetId: projectId,
			changes: { participantType, participantId },
			projectId,
		});
	});
	return { success: true };
}
