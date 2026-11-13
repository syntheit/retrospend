/**
 * What an account deletion would do, without changing anything (the summary
 * the delete sheet shows). Names come back blank, not as a failure, when the
 * instance key that sealed them is lost.
 */
import { textUnavailableProblem } from "~/server/crypto/field-open";
import type { PrismaClient } from "~prisma";
import { DELETED_USER_NAME, DELETED_USER_SENTINEL } from "./deleted-sentinels";
import type { PrismaTx } from "./user-deletion-ghosts";
import {
	countOtherUserOrganizers,
	findSuccessorOrganizer,
} from "./user-deletion-projects";

export interface DeletionPreview {
	projectsToTransfer: { id: string; name: string; newOrganizerName: string }[];
	projectsToDelete: { id: string; name: string }[];
	settlementsToAutoConfirm: number;
	settlementsToCancel: number;
	verificationsToAutoAccept: number;
	sharedTransactionsToAnonymize: number;
}

/**
 * Resolves a display name for a participant without throwing on missing records
 * or on a name whose key is unavailable.
 */
async function resolveParticipantDisplayName(
	db: PrismaClient | PrismaTx,
	participantType: string,
	participantId: string,
): Promise<string> {
	try {
		return await displayName(db, participantType, participantId);
	} catch (error) {
		// A name sealed with a key that is gone reads blank; the preview still shows.
		if (textUnavailableProblem(error)) return "";
		throw error;
	}
}

async function displayName(
	db: PrismaClient | PrismaTx,
	participantType: string,
	participantId: string,
): Promise<string> {
	if (participantId === DELETED_USER_SENTINEL) return DELETED_USER_NAME;

	if (participantType === "user") {
		const user = await (db as PrismaClient).user.findUnique({
			where: { id: participantId },
			select: { name: true },
		});
		return user?.name ?? "another member";
	}

	if (participantType === "shadow") {
		const shadow = await (db as PrismaClient).shadowProfile.findUnique({
			where: { id: participantId },
			select: { name: true },
		});
		return shadow?.name ?? "another member";
	}

	return "another member";
}


/**
 * The projects the user organizes, with their names. A project name is sealed
 * with the instance key; when that key is gone the names read blank and the
 * preview still shows, so the user can still delete the account.
 */
async function organizerRoles(
	db: PrismaClient,
	userId: string,
): Promise<{ projectId: string; name: string }[]> {
	const where = {
		participantType: "user",
		participantId: userId,
		role: "ORGANIZER",
	} as const;
	try {
		const roles = await db.projectParticipant.findMany({
			where,
			include: { project: { select: { id: true, name: true } } },
		});
		return roles.map((pp) => ({ projectId: pp.projectId, name: pp.project.name }));
	} catch (error) {
		if (!textUnavailableProblem(error)) throw error;
		const roles = await db.projectParticipant.findMany({
			where,
			select: { projectId: true },
		});
		return roles.map((pp) => ({ projectId: pp.projectId, name: "" }));
	}
}

/**
 * Computes what WOULD happen if the user deleted their account, without
 * modifying anything. Used to show the pre-deletion summary in the UI.
 */
export async function previewAccountDeletion(
	db: PrismaClient,
	userId: string,
): Promise<DeletionPreview> {
	const projectsToTransfer: DeletionPreview["projectsToTransfer"] = [];
	const projectsToDelete: DeletionPreview["projectsToDelete"] = [];

	// Step 1: Projects where user is the only organizer
	const userOrganizerRoles = await organizerRoles(db, userId);

	for (const pp of userOrganizerRoles) {
		if ((await countOtherUserOrganizers(db, pp.projectId, userId)) > 0)
			continue;

		const promotee = await findSuccessorOrganizer(db, pp.projectId, userId);

		if (!promotee) {
			projectsToDelete.push({ id: pp.projectId, name: pp.name });
		} else {
			const newOrganizerName = await resolveParticipantDisplayName(
				db,
				promotee.participantType,
				promotee.participantId,
			);
			projectsToTransfer.push({
				id: pp.projectId,
				name: pp.name,
				newOrganizerName,
			});
		}
	}

	// Step 2: Pending settlements
	const [settlementsAsPayer, settlementsAsPayee] = await Promise.all([
		db.settlement.findMany({
			where: {
				fromParticipantType: "user",
				fromParticipantId: userId,
				status: "PROPOSED",
			},
			select: { id: true, confirmedByPayer: true, confirmedByPayee: true },
		}),
		db.settlement.findMany({
			where: {
				toParticipantType: "user",
				toParticipantId: userId,
				status: "PROPOSED",
			},
			select: { id: true, confirmedByPayer: true, confirmedByPayee: true },
		}),
	]);

	let settlementsToAutoConfirm = 0;
	let settlementsToCancel = 0;

	// Same rule as preDeletionCleanup: one side agreed => auto-confirm.
	for (const s of settlementsAsPayer) {
		if (s.confirmedByPayer !== s.confirmedByPayee) settlementsToAutoConfirm++;
		else settlementsToCancel++;
	}
	for (const s of settlementsAsPayee) {
		if (s.confirmedByPayer !== s.confirmedByPayee) settlementsToAutoConfirm++;
		else settlementsToCancel++;
	}

	// Step 3: Pending verifications
	const verificationsToAutoAccept = await db.splitParticipant.count({
		where: {
			participantType: "user",
			participantId: userId,
			verificationStatus: "PENDING",
		},
	});

	// Shared transactions that will be anonymized
	const sharedTransactionsToAnonymize = await db.sharedTransaction.count({
		where: {
			OR: [
				{ paidByType: "user", paidById: userId },
				{ createdByType: "user", createdById: userId },
			],
		},
	});

	return {
		projectsToTransfer,
		projectsToDelete,
		settlementsToAutoConfirm,
		settlementsToCancel,
		verificationsToAutoAccept,
		sharedTransactionsToAnonymize,
	};
}
