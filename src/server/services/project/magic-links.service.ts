/**
 * Invite links: one active link per role, never for Owner. Callers check
 * that the caller is an editor first.
 */
import { TRPCError } from "@trpc/server";
import { env } from "~/env";
import { userTransaction } from "~/server/db-tx";
import { logAudit } from "~/server/services/shared-expenses/audit-log";
import type { PrismaClient } from "~prisma";
import type { ProjectActor, ProjectRoleName } from "./types";

export const inviteUrl = (projectId: string, linkId: string) =>
	`${env.PUBLIC_URL || env.NEXT_PUBLIC_APP_URL || "http://localhost:1997"}/projects/${projectId}?invite=${linkId}`;

/** Runs before the role check, so asking for an Owner link fails the same way for everyone. */
export function assertGrantableByLink(role: ProjectRoleName): void {
	if (role === "ORGANIZER") {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Magic links cannot grant the Owner role",
		});
	}
}

const audit = (
	tx: Parameters<typeof logAudit>[0],
	userId: string,
	projectId: string,
	action: "CREATED" | "EDITED",
	changes: Record<string, string | boolean>,
) =>
	logAudit(tx, {
		actor: { participantType: "user", participantId: userId },
		action,
		targetType: "PROJECT",
		targetId: projectId,
		changes,
		projectId,
	});

/** Returns the active link for this role when there is one, else creates it. */
export async function createMagicLink(
	db: PrismaClient,
	{ userId }: ProjectActor,
	input: {
		projectId: string;
		roleGranted: ProjectRoleName;
		expiresAt?: Date;
		maxUses?: number;
	},
) {
	const { projectId, roleGranted } = input;
	const existing = await db.magicLink.findFirst({
		where: { projectId, roleGranted, isActive: true },
	});
	if (existing) return { ...existing, url: inviteUrl(projectId, existing.id) };

	return userTransaction(db, userId, async (tx) => {
		const link = await tx.magicLink.create({
			data: {
				id: crypto.randomUUID(),
				projectId,
				roleGranted,
				createdById: userId,
				expiresAt: input.expiresAt ?? null,
				maxUses: input.maxUses ?? null,
			},
		});
		await audit(tx, userId, projectId, "CREATED", {
			linkId: link.id,
			roleGranted,
		});
		return { ...link, url: inviteUrl(projectId, link.id) };
	});
}

export function listMagicLinks(db: PrismaClient, projectId: string) {
	return db.magicLink.findMany({
		where: { projectId, isActive: true },
		orderBy: { createdAt: "desc" },
	});
}

export async function revokeMagicLink(
	db: PrismaClient,
	{ userId }: ProjectActor,
	projectId: string,
	linkId: string,
) {
	const link = await db.magicLink.findUnique({
		where: { id: linkId },
		select: { id: true, projectId: true },
	});
	if (!link || link.projectId !== projectId) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Magic link not found" });
	}
	return userTransaction(db, userId, async (tx) => {
		const updated = await tx.magicLink.update({
			where: { id: linkId },
			data: { isActive: false },
		});
		await audit(tx, userId, projectId, "EDITED", { linkId, revoked: true });
		return updated;
	});
}

/** Retires every active link for the role and issues a fresh one. */
export function resetMagicLink(
	db: PrismaClient,
	{ userId }: ProjectActor,
	projectId: string,
	role: ProjectRoleName,
) {
	return userTransaction(db, userId, async (tx) => {
		await tx.magicLink.updateMany({
			where: { projectId, roleGranted: role, isActive: true },
			data: { isActive: false },
		});
		const link = await tx.magicLink.create({
			data: {
				id: crypto.randomUUID(),
				projectId,
				roleGranted: role,
				createdById: userId,
			},
		});
		await audit(tx, userId, projectId, "CREATED", {
			linkId: link.id,
			roleGranted: role,
			reset: true,
		});
		return { ...link, url: inviteUrl(projectId, link.id) };
	});
}
