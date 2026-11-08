import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "~prisma";
import {
	recordParticipantRemoval,
	usersSharingWithParticipant,
} from "./admin-access.service";
import {
	anonymizeParticipantReferences,
	DELETED_GUEST_SENTINEL,
	deletedShadowSentinel,
} from "./user-deletion.service";

/**
 * An admin deleting a shadow Person: shared expenses and payments keep their
 * place under a "deleted" sentinel, and everyone it touches gets an entry in
 * their admin access log, in the same transaction. Pass the global client.
 */
export async function deleteShadowProfileAsAdmin(
	db: PrismaClient,
	params: { adminId: string; id: string },
): Promise<{ name: string }> {
	const profile = await db.shadowProfile.findUnique({
		where: { id: params.id },
		select: { id: true, name: true, createdById: true },
	});
	if (!profile) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Shadow profile not found" });
	}
	await db.$transaction(async (tx) => {
		const affectedUserIds = await usersSharingWithParticipant(tx, "shadow", profile.id);
		await anonymizeParticipantReferences(tx, "shadow", profile.id, deletedShadowSentinel(profile.id));
		await tx.shadowProfile.delete({ where: { id: profile.id } });
		await recordParticipantRemoval(tx, {
			adminId: params.adminId,
			ownerId: profile.createdById,
			affectedUserIds,
		});
	});
	return { name: profile.name };
}

/** The same for a guest session, which has no owner to tell. */
export async function deleteGuestSessionAsAdmin(
	db: PrismaClient,
	params: { adminId: string; id: string },
): Promise<{ name: string; email: string }> {
	const guest = await db.guestSession.findUnique({
		where: { id: params.id },
		select: { id: true, name: true, email: true },
	});
	if (!guest) {
		throw new TRPCError({ code: "NOT_FOUND", message: "Guest session not found" });
	}
	await db.$transaction(async (tx) => {
		const affectedUserIds = await usersSharingWithParticipant(tx, "guest", guest.id);
		await anonymizeParticipantReferences(tx, "guest", guest.id, DELETED_GUEST_SENTINEL);
		await tx.guestSession.delete({ where: { id: guest.id } });
		await recordParticipantRemoval(tx, { adminId: params.adminId, affectedUserIds });
	});
	return { name: guest.name, email: guest.email };
}
