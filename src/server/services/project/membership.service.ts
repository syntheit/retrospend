/**
 * Reading and changing project membership dates. `membersOn` is what the
 * expense sheet preselects for a project expense on a given day (RC-11).
 */
import { TRPCError } from "@trpc/server";
import { userTransaction } from "~/server/db-tx";
import { logAudit } from "~/server/services/shared-expenses/audit-log";
import type { PrismaClient } from "~prisma";
import {
	assertValidMembership,
	fromIsoDate,
	InvalidMembershipDatesError,
	type IsoDate,
	isMemberOn,
	type MembershipDates,
	membershipOf,
} from "./membership";
import type { MemberRef, ProjectActor } from "./types";

/** Turns a bad date into the BAD_REQUEST a procedure returns. */
export function badDates<T>(work: () => T): T {
	try {
		return work();
	} catch (error) {
		if (error instanceof InvalidMembershipDatesError) {
			throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
		}
		throw error;
	}
}

/** Everyone who was a member of the project on `day`, with their dates and role. */
export async function membersOn(
	db: PrismaClient,
	projectId: string,
	day: IsoDate,
) {
	const rows = await db.projectParticipant.findMany({
		where: { projectId },
		select: {
			participantType: true,
			participantId: true,
			role: true,
			joinedOn: true,
			leftOn: true,
		},
		orderBy: { joinedAt: "asc" },
	});
	return rows
		.map((r) => ({
			participantType: r.participantType,
			participantId: r.participantId,
			role: r.role,
			...membershipOf(r),
		}))
		.filter((m) => isMemberOn(m, day));
}

export interface SetMembershipInput extends MemberRef {
	projectId: string;
	/** Omit to keep; null clears it ("from the start"). */
	joinedOn?: IsoDate | null;
	/** Omit to keep; null clears it ("still a member"). */
	leftOn?: IsoDate | null;
}

/**
 * Sets when someone joined or left. Leaving keeps them in the project (their
 * past expenses and balances stay); it only stops new expenses from
 * including them by default. The caller must be an editor.
 */
export async function setMembershipDates(
	db: PrismaClient,
	{ userId }: ProjectActor,
	input: SetMembershipInput,
) {
	const { projectId, participantType, participantId } = input;
	const row = await db.projectParticipant.findUnique({
		where: {
			projectId_participantType_participantId: {
				projectId,
				participantType,
				participantId,
			},
		},
	});
	if (!row) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Participant not found in this project",
		});
	}
	const before = membershipOf(row);
	const after: MembershipDates = {
		joinedOn: input.joinedOn === undefined ? before.joinedOn : input.joinedOn,
		leftOn: input.leftOn === undefined ? before.leftOn : input.leftOn,
	};
	const data = badDates(() => {
		assertValidMembership(after);
		return {
			joinedOn: after.joinedOn ? fromIsoDate(after.joinedOn) : null,
			leftOn: after.leftOn ? fromIsoDate(after.leftOn) : null,
		};
	});

	return userTransaction(db, userId, async (tx) => {
		const updated = await tx.projectParticipant.update({
			where: { id: row.id },
			data,
		});
		await logAudit(tx, {
			actor: { participantType: "user", participantId: userId },
			action: "EDITED",
			targetType: "PROJECT",
			targetId: projectId,
			changes: {
				participantType,
				participantId,
				membership: { old: { ...before }, new: { ...after } },
			},
			projectId,
		});
		return {
			participantType,
			participantId,
			role: updated.role,
			...membershipOf(updated),
		};
	});
}
