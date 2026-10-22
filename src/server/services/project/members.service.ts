/**
 * Project membership: adding people, roles, ownership and removal. Callers
 * have already checked the caller's role with requireProjectRole and pass it
 * in, because several rules depend on it.
 */
import { TRPCError } from "@trpc/server";
import { env } from "~/env";
import { userTransaction } from "~/server/db-tx";
import { notificationEmail } from "~/server/email-templates";
import { sendEmail } from "~/server/mailer";
import {
	createNotification,
	resolveParticipantName,
} from "~/server/services/notifications";
import { logAudit } from "~/server/services/shared-expenses/audit-log";
import type { PrismaClient } from "~prisma";
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
	input: MemberRef & { projectId: string; role: ProjectRoleName },
) {
	const { projectId, participantType, participantId } = input;
	await assertAddable(db, userId, projectId, {
		participantType,
		participantId,
	});
	const role = capGhostRole(participantType, input.role);
	assertCanGrantRole(callerRole, role);

	const participant = await userTransaction(db, userId, async (tx) => {
		const p = await tx.projectParticipant.create({
			data: { projectId, participantType, participantId, role },
		});
		await logAudit(tx, {
			actor: { participantType: "user", participantId: userId },
			action: "PARTICIPANT_ADDED",
			targetType: "PROJECT",
			targetId: projectId,
			changes: { participantType, participantId, role },
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

async function projectName(db: PrismaClient, projectId: string) {
	const project = await db.project.findUnique({
		where: { id: projectId },
		select: { name: true },
	});
	return project?.name ?? null;
}

async function notifyAddedUser(
	db: PrismaClient,
	userId: string,
	projectId: string,
	addedUserId: string,
) {
	const name = await projectName(db, projectId);
	const actorName = await resolveParticipantName("user", userId);
	createNotification({
		userId: addedUserId,
		type: "PARTICIPANT_ADDED",
		title: "Added to project",
		body: `${actorName} added you to '${name ?? "a project"}'`,
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
	const name = (await projectName(db, projectId)) ?? "a project";
	const actorName = await resolveParticipantName("user", userId);
	const base = appUrl();
	const title = "You've been added to a project";

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

	const body = joinUrl
		? `${actorName} added you to '${name}' on Retrospend. Click the button below to join and view shared expenses.`
		: `${actorName} added you to '${name}' on Retrospend.${base ? " Sign in or create an account to view and manage shared expenses." : ""}`;
	const html = notificationEmail({
		title,
		body,
		ctaUrl: joinUrl,
		ctaLabel: joinUrl ? "Join Project" : undefined,
	});
	sendEmail(shadow.email, `Retrospend: ${title}`, html).catch((err) =>
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

/** Caller must be an owner and the creator; the old owner becomes an editor. */
export async function transferOwnership(
	db: PrismaClient,
	{ userId }: ProjectActor,
	input: { projectId: string; newOwnerId: string; confirmProjectName: string },
) {
	const { projectId, newOwnerId } = input;
	const project = await creatorOf(db, projectId);
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

	const callerName = await resolveParticipantName("user", userId);
	void createNotification({
		userId: newOwnerId,
		type: "PARTICIPANT_ADDED",
		title: "Ownership transferred",
		body: `${callerName} transferred ownership of "${project.name}" to you.`,
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
